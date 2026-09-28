import { createServer } from 'node:http';
import { Client, Events, GatewayIntentBits } from 'discord.js';
import { loadEnv, loadGuildConfig } from './config.js';
import { connectDb } from './db/client.js';
import { ShuinApp } from './discord/app.js';
import { StaffApp } from './discord/staff.js';
import { AdmissionApp } from './discord/admission.js';
import { TempVoiceApp } from './discord/tempVoice.js';
import { OmikujiApp } from './discord/omikuji.js';
import { OnboardingApp } from './discord/onboarding.js';
import { InviteLinkApp } from './discord/inviteLinks.js';
import { VoiceGroupApp } from './discord/voiceGroups.js';
import { VoiceChatClearApp } from './discord/voiceChatClear.js';
import { BellApp, BellStickyApp } from './discord/bell.js';
import { GachaApp } from './discord/gacha.js';
import { GuidePendingApp } from './discord/guidePending.js';
import { WalletApp } from './discord/wallet.js';
import { GlossaryApp } from './discord/glossary.js';
import { TempGrantApp } from './discord/tempGrants.js';
import { MeetingApp } from './discord/meetings.js';
import { HelpApp } from './discord/help.js';
import { expireTick } from './services/tempGrants.js';
import { announceEvents } from './services/economyEvents.js';
import { interviewTick, loadInterview } from './services/interview.js';
import { checkAlerts, weeklyTick } from './services/economyWatch.js';
import { onboardingTick } from './services/onboarding.js';
import { inviteActiveTick } from './services/invites.js';
import { OmamoriApp } from './discord/omamori.js';
import { RecruitApp } from './discord/recruit.js';
import { ShopApp } from './discord/shop.js';
import { updateBanzukeQuietly } from './services/banzuke.js';
import { BoostApp } from './discord/boost.js';
import { processCoreTimeNotices } from './services/coreTime.js';
import { StickyApp } from './discord/sticky.js';
import { VoicePanelApp } from './discord/voicePanel.js';
import { RoomApp } from './discord/rooms.js';
import { MarketApp } from './discord/market.js';
import { ConfigStore } from './services/settings.js';
import { guildChannelsCached, syncCurrencyRename } from './services/notices.js';
import { announceUpdates } from './services/updateNews.js';
import { createDiscordActions } from './lib/discordRest.js';
import { commandDefinitions } from './discord/commands.js';
import { logger } from './lib/logger.js';
import { explainStartupError } from './lib/startupErrors.js';

async function main(): Promise<void> {
  const env = loadEnv();
  const fileCfg = loadGuildConfig(env.GUILD_CONFIG);
  const { db, close } = await connectDb(env.DATABASE_URL);
  logger.info('database ready');
  // 管理画面で変えた設定を重ねる（1 分ごとに読み直す）
  const store = new ConfigStore(db, fileCfg);
  await store.refresh();
  store.start();
  const cfg = () => store.current;

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.GuildVoiceStates,
    ],
  });
  const app = new ShuinApp(client, db, cfg);
  const actions = createDiscordActions(env.DISCORD_TOKEN);
  const staff = new StaffApp(client, db, cfg, actions, env.WEB_BASE_URL);
  const admission = new AdmissionApp(client, db, cfg, actions);
  // 宿坊・宵宮の部屋の設定（種類・人数・招待・花びら）
  let rooms: RoomApp | undefined;
  const tempVoice = new TempVoiceApp(db, cfg, (channelId, ownerId) => rooms?.onCreated(channelId, ownerId) ?? Promise.resolve());
  rooms = new RoomApp(db, cfg, (channelId) => tempVoice.close(channelId));
  const omikuji = new OmikujiApp(db, cfg);
  const gacha = new GachaApp(db, cfg);
  const wallet = new WalletApp(db, cfg);
  const glossary = new GlossaryApp(db, cfg);
  const tempGrants = new TempGrantApp(db, cfg, actions);
  const meetingApp = new MeetingApp(db, cfg, actions, env.WEB_BASE_URL);
  const help = new HelpApp(cfg);
  const guidePending = new GuidePendingApp(cfg);
  const onboarding = new OnboardingApp(db, cfg);
  const inviteLinks = new InviteLinkApp(db, cfg);
  const voiceGroups = new VoiceGroupApp(cfg);
  const voiceChatClear = new VoiceChatClearApp(cfg);
  const bell = new BellApp(client, db, cfg, actions);
  const bellSticky = new BellStickyApp(cfg);
  const omamori = new OmamoriApp(cfg);
  const recruit = new RecruitApp(db, cfg, actions);
  const shop = new ShopApp(db, cfg, actions);
  const boost = new BoostApp(db, cfg, actions);
  const sticky = new StickyApp(db, cfg, actions);
  const market = new MarketApp(db, cfg, actions);
  const voicePanel = new VoicePanelApp(cfg);
  let ticker: NodeJS.Timeout | undefined;
  let omairiTicker: NodeJS.Timeout | undefined;

  client.once(Events.ClientReady, async (c) => {
    logger.info({ user: c.user.tag }, 'logged in');
    const guild = await c.guilds.fetch(fileCfg.guildId).catch(() => undefined);
    if (!guild) {
      logger.error({ guildId: fileCfg.guildId }, 'BOT がこのサーバーに参加していません');
      return;
    }
    // どれかが失敗しても（Discord が混んでいるなど）、止まらずに続ける
    await guild.commands
      .set(commandDefinitions(cfg()))
      .then(() => logger.info({ guild: guild.name }, 'commands registered'))
      .catch((err) => logger.error({ err }, 'command registration failed'));
    // 通貨の名前を変えたあと（花びら → 銭）: 投稿済みの掲示を出し直す（1 回だけ）
    await syncCurrencyRename({ db, cfg: cfg(), discord: actions }).catch((err) => logger.warn({ err }, 'currency rename sync failed'));
    // 📰 更新速報: 自動更新で入った新しい更新を #更新速報 に
    await guildChannelsCached(actions, fileCfg.guildId, true)
      .then((channels) => announceUpdates({ db, discord: actions, channels }))
      .catch((err) => logger.warn({ err }, 'update news failed'));
    // 管理画面用に全員を同期（BOT が止まっていた間の参加・退出も反映）
    await guild.members
      .fetch()
      .then((all) => app.syncAll(all.values()))
      .catch((err) => logger.error({ err }, 'member sync failed'));
    // 🧭 案内待ち: 止まっていた間に参加時の質問を終えた人・承認された人も合わせる
    await guidePending.attach(guild).catch((err) => logger.warn({ err }, 'guide pending attach failed'));
    // 招待リンク: 使われた回数を覚え直す
    await inviteLinks.attach(guild).catch((err) => logger.warn({ err }, 'invite links attach failed'));
    // 絵馬待ちの人: 止まっていた間に書かれた自己紹介を拾う
    await admission.catchUpIntros(guild).catch((err) => logger.warn({ err }, 'intro catch-up failed'));
    // 自分の通話部屋: 止まっていた間に空になったものを消す
    await tempVoice.attach(guild).catch((err) => logger.warn({ err }, 'temp voice attach failed'));
    rooms.attach(guild);
    // 自動で増える通話（大きな縁側 1〜3 など）
    await voiceGroups.attach(guild).catch((err) => logger.warn({ err }, 'voice groups attach failed'));
    // 人がいなくなった通話のチャットを消す（止まっていた間に空になったものも）
    voiceChatClear.attach(guild);
    // 呼び鈴のボタンを、決めたチャンネルのいちばん下に
    bellSticky.attach(guild);
    market.attach(guild);
    gacha.attach(guild);
    // ショップ: 最初の品物を並べる
    await shop.attach(guild).catch((err) => logger.warn({ err }, 'shop attach failed'));
    // ブースト: 止まっていた間の「ブーストしました」を拾う
    await boost.attach(guild).catch((err) => logger.warn({ err }, 'boost attach failed'));
    // 募集ボタン: なければ置く
    await recruit.attach(guild).catch((err) => logger.warn({ err }, 'recruit panels failed'));
    // 1 分ごと: 通話時間・花びら・発言数、空の通話部屋の片付け（念のため）
    ticker = setInterval(() => {
      void app.everyMinute(guild);
      void tempVoice.cleanup();
      void voiceGroups.checkAll().catch((err) => logger.warn({ err }, 'voice groups check failed'));
      // 1 時間ごとの部屋（宵宮）の支払い
      void rooms.tick().catch((err) => logger.warn({ err }, 'room billing failed'));
      // コアタイムの予告（前日・始まる前に #境内 へ）
      void processCoreTimeNotices({ db, cfg: cfg(), discord: actions }).catch((err) => logger.warn({ err }, 'core time notice failed'));
      // ⏳ 一時的なロール・権限: 期限が来たものを外す
      void expireTick({ db, cfg: cfg(), discord: actions }).catch((err) => logger.warn({ err }, 'temp grant expire failed'));
      // 面談告知: 予約した告知と、1 時間前・10 分前のリマインドを流す
      void loadInterview(db)
        .then((st) => interviewTick({ db, discord: actions }, st))
        .catch((err) => logger.warn({ err }, 'interview tick failed'));
      // 期間限定イベント（ボーナス週間・セール）の始まり・終わりを知らせる
      void announceEvents({ db, cfg: cfg(), discord: actions }).catch((err) => logger.warn({ err }, 'economy event announce failed'));
    }, 60_000);
    // 10 分ごと: お参り期間の判定
    const omairi = () => void admission.checkOmairi().catch((err) => logger.warn({ err }, 'omairi check failed'));
    // 10 分ごと: 番付の書き換え
    const banzuke = () => void updateBanzukeQuietly({ db, cfg: cfg(), discord: actions });
    const every10 = () => {
      omairi();
      banzuke();
      // 期限が来た授与品（色守り・絵馬のピン留め）を外す
      void shop.expire().catch((err) => logger.warn({ err }, 'shop expire failed'));
      // 期限が来た名前の飾りを外す
      void gacha.tick().catch((err) => logger.warn({ err }, 'gacha tick failed'));
      // ブースト（奉納）のお礼と奉納板（止まっていた間の分もここで拾う）
      void boost.tick();
      // 市場: 期限が来た取引を売った人に渡す
      void market.tick().catch((err) => logger.warn({ err }, 'market release failed'));
      // はじめての参拝: 全部できた人にお祝い
      void onboardingTick({ db, cfg: cfg(), discord: actions }).catch((err) => logger.warn({ err }, 'onboarding tick failed'));
      // 招待: 招待された人が浮上した日ごとに、招待した人へボーナス
      void inviteActiveTick(db, cfg()).catch((err) => logger.warn({ err }, 'invite active tick failed'));
      // 呼び鈴のボタン（設定で足したチャンネルにも）
      bellSticky.checkAll();
      // いちばん下に表示し続ける掲示（#絵馬 のひな形・朱印ボタン）が下にないときは出し直す
      void sticky.checkAll(guild).catch((err) => logger.warn({ err }, 'sticky check failed'));
      // 経済の見守り: 動きが多い人の警告、週ごとのお知らせとお賽銭
      void (async () => {
        const ctx = { db, cfg: cfg(), discord: actions };
        await checkAlerts(ctx);
        await weeklyTick(ctx);
      })().catch((err) => logger.warn({ err }, 'economy watch failed'));
    };
    every10();
    omairiTicker = setInterval(every10, 10 * 60_000);
  });
  client.on(Events.GuildMemberAdd, (m) => {
    void app.onMemberAdd(m);
    // だれの招待リンクで入ったか
    void inviteLinks.onMemberAdd(m);
    // 入った瞬間に 🧭案内待ち
    void guidePending.onMemberAdd(m).catch((err) => logger.warn({ err }, 'guide pending add failed'));
    // 入った人に、はじめの流れを DM で案内
    void admission.onMemberAdd(m).catch((err) => logger.warn({ err }, 'join guide dm failed'));
  });
  client.on(Events.GuildMemberRemove, (m) => void app.onMemberRemove(m.guild.id, m.id));
  client.on(Events.GuildMemberUpdate, (old, m) => {
    void (async () => {
      await app.onMemberUpdate(m);
      // 承認されて絵馬待ち・役職になったら 🧭案内待ちを外す
      await guidePending.onMemberUpdate(old, m).catch((err) => logger.warn({ err }, 'guide pending update failed'));
      // ブースト（奉納）を始めた・やめたら、すぐお礼と奉納板を
      if ((old.premiumSince?.getTime() ?? null) !== (m.premiumSince?.getTime() ?? null)) await boost.tick(m.id);
    })();
  });
  client.on(Events.VoiceStateUpdate, (before, after) => {
    // 通話に入った・移動したとき
    if (after.channelId && after.channelId !== before.channelId && after.member) {
      void app.onActivity(after.guild.id, after.id, after.member.user.bot);
    }
    void tempVoice.onVoiceStateUpdate(before, after);
    // 自動で増える通話: 全部埋まったら増やし、空きが増えたら減らす
    voiceGroups.onVoiceStateUpdate(before, after);
    // 人がいなくなった通話のチャットを消す
    voiceChatClear.onVoiceStateUpdate(before, after);
    // 通話のチャットに「この通話の人に朱印を押す」
    voicePanel.onVoiceStateUpdate(before, after);
    // 宵宮の部屋: 入った人がそれぞれ払う
    void rooms.onVoiceStateUpdate(before, after);
  });
  client.on(Events.InteractionCreate, (i) => {
    void app.onInteraction(i);
    void staff.onInteraction(i);
    void admission.onInteraction(i);
    void omikuji.onInteraction(i);
    void gacha.onInteraction(i);
    void wallet.onInteraction(i);
    void glossary.onInteraction(i);
    void tempGrants.onInteraction(i);
    void meetingApp.onInteraction(i);
    void help.onInteraction(i);
    void onboarding.onInteraction(i);
    void inviteLinks.onInteraction(i);
    void bell.onInteraction(i);
    void omamori.onInteraction(i);
    void recruit.onInteraction(i);
    void shop.onInteraction(i);
    void rooms.onInteraction(i);
    void market.onInteraction(i);
  });
  client.on(Events.MessageCreate, (m) => {
    void app.onMessage(m);
    recruit.onMessage(m);
    void boost.onMessage(m);
    void sticky.onMessage(m);
    // 通話のチャット: 「この通話の人のプロフィールを見る」をいちばん下へ（15 秒に 1 回まで）
    voicePanel.onMessage(m);
    // 呼び鈴のボタン: 話が落ち着いたらいちばん下へ
    bellSticky.onMessage(m);
    // 絵馬待ちの人が自己紹介を書いたら、🔰参拝者 に
    void admission.onMessage(m).catch((err) => logger.warn({ err }, 'intro check failed'));
  });
  client.on(Events.Error, (err) => logger.error({ err }, 'client error'));

  const health =
    env.HEALTH_PORT > 0
      ? createServer((_req, res) => {
          const ok = client.isReady();
          res.writeHead(ok ? 200 : 503, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok }));
        }).listen(env.HEALTH_PORT)
      : undefined;

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'shutting down');
    health?.close();
    if (ticker) clearInterval(ticker);
    if (omairiTicker) clearInterval(omairiTicker);
    store.stop();
    await client.destroy();
    await close();
    process.exit(0);
  };
  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));

  await client.login(env.DISCORD_TOKEN);
}

// 取りこぼした失敗で BOT ごと止まらないように（記録だけ残す）
process.on('unhandledRejection', (err) => logger.error({ err }, 'unhandled rejection'));

main().catch((err) => {
  // よくある設定ミスは、直し方を日本語で出す
  const hint = explainStartupError(err);
  if (hint) console.error(`\n❌ 起動できませんでした。\n${hint}\n`);
  logger.fatal({ err }, 'failed to start');
  process.exit(1);
});
