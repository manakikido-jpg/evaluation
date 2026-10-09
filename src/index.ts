import { opsWeeklyTick, pruneOpsNotices, staleTick } from './services/opsWatch.js';
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
import { GiftApp } from './discord/gifts.js';
import { OtoshidamaApp } from './discord/otoshidama.js';
import { BoardApp } from './discord/board.js';
import { CastApp } from './discord/cast.js';
import { TicketApp } from './discord/supportTickets.js';
import { VoiceGroupApp } from './discord/voiceGroups.js';
import { VoiceChatClearApp } from './discord/voiceChatClear.js';
import { BellApp, BellStickyApp } from './discord/bell.js';
import { GachaApp } from './discord/gacha.js';
import { PresentApp } from './discord/presents.js';
import { retireOmamori } from './discord/retireOmamori.js';
import { GuideReceptionApp } from './discord/guideReception.js';
import { GuidePendingApp } from './discord/guidePending.js';
import { WalletApp } from './discord/wallet.js';
import { SokinApp } from './discord/sokin.js';
import { CasinoApp } from './discord/casino.js';
import { GlossaryApp } from './discord/glossary.js';
import { TempGrantApp } from './discord/tempGrants.js';
import { MeetingApp } from './discord/meetings.js';
import { HelpApp } from './discord/help.js';
import { expireTick } from './services/tempGrants.js';
import { announceEvents, voiceTicketDm, voiceTicketTick } from './services/economyEvents.js';
import { sweepTables } from './services/casino/tables/service.js';
import { keibaTick } from './services/casino/keibaNotify.js';
import { sweepMatches } from './services/casino/versus.js';
import { interviewTick, loadInterview } from './services/interview.js';
import { checkAlerts, weeklyTick } from './services/economyWatch.js';
import { onboardingTick } from './services/onboarding.js';
import { inviteActiveTick } from './services/invites.js';
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
import { pingRoleIds } from './services/notify.js';
import { explainStartupError } from './lib/startupErrors.js';
import { profitShareDm, profitShareLog, settleProfitShare } from './services/casino/profitShare.js';

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
  const presents = new PresentApp(db, cfg);
  const wallet = new WalletApp(db, cfg);
  const sokin = new SokinApp(db, cfg);
  const casino = new CasinoApp(cfg, env.WEB_BASE_URL, db);
  const glossary = new GlossaryApp(db, cfg);
  const tempGrants = new TempGrantApp(db, cfg, actions);
  const meetingApp = new MeetingApp(db, cfg, actions, env.WEB_BASE_URL);
  const help = new HelpApp(cfg);
  const guideReception = new GuideReceptionApp(db, cfg, actions);
  const guidePending = new GuidePendingApp(cfg);
  const onboarding = new OnboardingApp(db, cfg);
  const inviteLinks = new InviteLinkApp(db, cfg);
  const gifts = new GiftApp(db, cfg, actions);
  const otoshidama = new OtoshidamaApp(db, cfg, actions);
  const voiceGroups = new VoiceGroupApp(cfg);
  const voiceChatClear = new VoiceChatClearApp(cfg);
  const bell = new BellApp(client, db, cfg, actions);
  const bellSticky = new BellStickyApp(cfg);
  const recruit = new RecruitApp(db, cfg, actions);
  const shop = new ShopApp(db, cfg, actions);
  const boost = new BoostApp(db, cfg, actions);
  const sticky = new StickyApp(db, cfg, actions);
  const market = new MarketApp(db, cfg, actions);
  const board = new BoardApp(db, cfg, actions);
  const cast = new CastApp(db, cfg, actions);
  const supportTickets = new TicketApp(db, cfg, actions);
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
    // #面談日程: 止まっていた間に案内待ちが外れた人・抜けた人の書き込みを消す
    void guidePending.sweepSchedule(guild);
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
    // ⛩ 「御神籤を引く」ボタンを #おみくじ のいちばん下に
    await omikuji.attach(guild).catch((err) => logger.warn({ err }, 'omikuji panel attach failed'));
    market.attach(guild);
    board.attach(guild);
    // 止まっていた間に消された募集のカードを出し直す
    void board
      .checkCards()
      .then(() => board.checkPanel())
      .catch((err) => logger.warn({ err }, 'board card check failed'));
    cast.attach(guild);
    supportTickets.attach(guild);
    gacha.attach(guild);
    // 物御籤のボタンの名前を変えたら、置いてあるボタンも書き換える
    await gacha.refreshPanels(guild).catch((err) => logger.warn({ err }, 'gacha panels refresh failed'));
    await market.refreshPanels(guild).catch((err) => logger.warn({ err }, 'market panels refresh failed'));
    // ショップ: 最初の品物を並べる
    await shop.attach(guild).catch((err) => logger.warn({ err }, 'shop attach failed'));
    // ブースト: 止まっていた間の「ブーストしました」を拾う
    await boost.attach(guild).catch((err) => logger.warn({ err }, 'boost attach failed'));
    // 🧧 なくしたお守り（募集の通知のロール）と #授与所 のボタンを 1 回だけ消す
    await retireOmamori(db, cfg(), guild, actions).catch((err) => logger.warn({ err }, 'omamori retire failed'));
    // 募集ボタン: なければ置く
    await recruit.attach(guild).catch((err) => logger.warn({ err }, 'recruit panels failed'));
    // 1 分ごと: 通話時間・花びら・発言数、空の通話部屋の片付け（念のため）
    ticker = setInterval(() => {
      void guideReception.tick(guild).catch(err => logger.warn({ err }, 'guide tick failed'));
      void app.everyMinute(guild);
      // ✨ 特別ご縁を振られた人の昇格（社務所Web から振ったもの）
      void app.checkSpecialGoen(guild).catch((err) => logger.warn({ err }, 'special goen check failed'));
      void tempVoice.cleanup();
      void voiceGroups.checkAll().catch((err) => logger.warn({ err }, 'voice groups check failed'));
      // 市場: 期限が来た取引を渡す・返事のない提案を取り下げる・📞 待機の時間切れ
      void market.tick().catch((err) => logger.warn({ err }, 'market tick failed'));
      // 1 時間ごとの部屋（宵宮）の支払い
      void rooms.tick().catch((err) => logger.warn({ err }, 'room billing failed'));
      // コアタイムの予告（前日・始まる前に #境内 へ）
      void processCoreTimeNotices({ db, cfg: cfg(), discord: actions }).catch((err) => logger.warn({ err }, 'core time notice failed'));
      // 🎀 キャスト: 返事待ちの期限・予約の始まり・通話の終わり・部屋の片付け
      void cast.syncIntros().catch(err => logger.warn({ err }, 'cast intros sync failed'));
      void cast.tick().catch((err) => logger.warn({ err }, 'cast tick failed'));
      // 🎫 チケット: 返事のない知らせ・自動で閉じる
      void supportTickets.tick().catch((err) => logger.warn({ err }, 'ticket tick failed'));
      // 🧧 お年玉袋: 締め切りが来た袋の残りを置いた人に戻す
      void otoshidama.tick().catch((err) => logger.warn({ err }, 'otoshidama tick failed'));
      // ⏳ 一時的なロール・権限: 期限が来たものを外す
      void expireTick({ db, cfg: cfg(), discord: actions }).catch((err) => logger.warn({ err }, 'temp grant expire failed'));
      // 面談告知: 予約した告知と、1 時間前・10 分前のリマインドを流す
      void loadInterview(db)
        .then((st) => interviewTick({ db, discord: actions, rankRoleIds: pingRoleIds(cfg()) }, st))
        .catch((err) => logger.warn({ err }, 'interview tick failed'));
      // 期間限定イベント（ボーナス週間・セール）の始まり・終わりを知らせる
      void announceEvents({ db, cfg: cfg(), discord: actions }).catch((err) => logger.warn({ err }, 'economy event announce failed'));
      // 🏇 馬主の馬が勝ったらお祝い・馬主ロール
      void keibaTick({ db, cfg: cfg(), discord: actions }).catch((err) => logger.warn({ err }, 'keiba tick failed'));
      // 🎰 カジノ: だれも見ていない卓・対戦も、時間が来たら進める（持ち時間切れ・返金）
      void sweepTables(db, cfg())
        .then(() => sweepMatches(db))
        .catch((err) => logger.warn({ err }, 'casino sweep failed'));
      // 💰 カジノの収益の分け前: 日が変わったら、前の日の分を宮司へ（1 日 1 回だけ。DM と #記録）
      void settleProfitShare(db, cfg())
        .then(async (row) => {
          if (!row) return;
          const coin = `${cfg().economy.currencyEmoji}${cfg().economy.currencyName}`;
          for (const r of row.recipients) await actions.sendDm(r.memberId, profitShareDm(row, r.amount, coin)).catch(() => false);
          const log = cfg().channels.log;
          const text = profitShareLog(row, coin);
          if (log && text) await actions.sendMessage(log, { content: text, allowed_mentions: { parse: [] } }).catch(() => undefined);
        })
        .catch((err) => logger.warn({ err }, 'casino profit share failed'));
      // 🎫 通話で券: 決めた日に、通話が決めた分数になった人へ券を配って DM で知らせる
      void voiceTicketTick(db, cfg())
        .then(async (granted) => {
          for (const g of granted) await actions.sendDm(g.memberId, voiceTicketDm(g)).catch(() => false);
        })
        .catch((err) => logger.warn({ err }, 'voice ticket tick failed'));
    }, 60_000);
    // 10 分ごと: お参り期間の判定
    const omairi = () => void admission.checkOmairi().catch((err) => logger.warn({ err }, 'omairi check failed'));
    // 10 分ごと: 番付の書き換え
    const banzuke = () => void updateBanzukeQuietly({ db, cfg: cfg(), discord: actions });
    const every10 = () => {
      // 招待: 昇格の通知を逃した未払いを拾う（支払済みは重ねて渡さない）
      void app.reconcileInviteRewards(guild).catch((err) => logger.warn({ err }, 'invite reward reconciliation failed'));
      omairi();
      banzuke();
      // 期限が来た授与品（色守り・絵馬のピン留め）を外す
      void shop.expire().catch((err) => logger.warn({ err }, 'shop expire failed'));
      // 期限が来た名前の飾りを外す
      void gacha.tick().catch((err) => logger.warn({ err }, 'gacha tick failed'));
      // ブースト（奉納）のお礼と奉納板（止まっていた間の分もここで拾う）
      void boost.tick();
      // 📌 掲示板: 期限が来た募集を締め切り、期限が来た採用に報酬を渡す（消されたカードも出し直す）
      void board.tick().catch((err) => logger.warn({ err }, 'board tick failed'));
      // #面談日程: 案内待ちが外れた人・抜けた人の書き込みの取りこぼしを消す
      void guidePending.sweepSchedule(guild);
      // はじめての参拝: 全部できた人にお祝い
      void onboardingTick({ db, cfg: cfg(), discord: actions }).catch((err) => logger.warn({ err }, 'onboarding tick failed'));
      // 招待: 招待された人が浮上した日ごとに、招待した人へボーナス
      void inviteActiveTick(db, cfg()).catch((err) => logger.warn({ err }, 'invite active tick failed'));
      // 呼び鈴のボタン（設定で足したチャンネルにも）
      bellSticky.checkAll();
      omikuji.checkPanel();
      // いちばん下に表示し続ける掲示（#絵馬 のひな形・朱印ボタン）が下にないときは出し直す
      void sticky.checkAll(guild).catch((err) => logger.warn({ err }, 'sticky check failed'));
      // 経済の見守り: 動きが多い人の警告、週ごとのお知らせとお賽銭
      void (async () => {
        const ctx = { db, cfg: cfg(), discord: actions };
        await checkAlerts(ctx);
        await weeklyTick(ctx);
      })().catch((err) => logger.warn({ err }, 'economy watch failed'));
      // 運営の見守り: 対応待ちがそのままなら知らせる・週ごとのまとめ
      void (async () => {
        const ctx = { db, cfg: cfg(), discord: actions, baseUrl: env.WEB_BASE_URL };
        await staleTick(ctx);
        await opsWeeklyTick(ctx);
        await pruneOpsNotices(db);
      })().catch((err) => logger.warn({ err }, 'ops watch failed'));
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
  client.on(Events.GuildMemberRemove, (m) => {
    void app.onMemberRemove(m.guild.id, m.id);
    // 抜けた人の #面談日程 の書き込みを消す
    void guidePending.onMemberRemove(m.guild, m.id).catch((err) => logger.warn({ err }, 'interview schedule clear failed'));
  });
  client.on(Events.GuildMemberUpdate, (old, m) => {
    void (async () => {
      await app.onMemberUpdate(m, old);
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
    void guideReception.onVoiceStateUpdate(before, after);
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
    void guideReception.onInteraction(i);
    void app.onInteraction(i);
    void staff.onInteraction(i);
    void admission.onInteraction(i);
    void omikuji.onInteraction(i);
    void gacha.onInteraction(i);
    void presents.onInteraction(i);
    void wallet.onInteraction(i);
    void sokin.onInteraction(i);
    void casino.onInteraction(i);
    void glossary.onInteraction(i);
    void tempGrants.onInteraction(i);
    void meetingApp.onInteraction(i);
    void help.onInteraction(i);
    void onboarding.onInteraction(i);
    void inviteLinks.onInteraction(i);
    void gifts.onInteraction(i);
    void otoshidama.onInteraction(i);
    void bell.onInteraction(i);
    void recruit.onInteraction(i);
    void shop.onInteraction(i);
    void rooms.onInteraction(i);
    void market.onInteraction(i);
    void board.onInteraction(i);
    void cast.onInteraction(i);
    void supportTickets.onInteraction(i);
  });
  client.on(Events.MessageCreate, (m) => {
    void app.onMessage(m);
    // 案内人の受付のパネル: いつもいちばん下に
    void guideReception.onMessage(m).catch((err) => logger.warn({ err }, 'guide panel message failed'));
    void supportTickets.onMessage(m).catch((err) => logger.warn({ err }, 'ticket message failed'));
    recruit.onMessage(m);
    void boost.onMessage(m);
    void sticky.onMessage(m);
    // 通話のチャット: 「この通話の人のプロフィールを見る」をいちばん下へ（15 秒に 1 回まで）
    voicePanel.onMessage(m);
    // 呼び鈴のボタン: 話が落ち着いたらいちばん下へ
    bellSticky.onMessage(m);
    // ⛩ 御神籤のボタン: 書き込みが落ち着いたらいちばん下へ
    omikuji.onMessage(m);
    // 絵馬待ちの人が自己紹介を書いたら、🔰参拝者 に
    void admission.onMessage(m).catch((err) => logger.warn({ err }, 'intro check failed'));
  });
  // 📌 掲示板: 募集のカードが消されたら出し直す
  client.on(Events.MessageDelete, (m) => void board.onMessageDelete(m).catch((err) => logger.warn({ err }, 'board message delete failed')));
  client.on(Events.MessageDelete, (m) => void omikuji.onMessageDelete(m).catch((err) => logger.warn({ err }, 'omikuji panel delete failed')));
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
