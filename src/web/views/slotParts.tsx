/** 🎰 実機の部品（SAKURA 777 と AT 機で同じ）。動きは casino.js の Real */

/** MAX BET ボタンと BET ランプ（1・2・3）。レバーでも自動で点く */
export function MaxBet(p: { lit?: boolean }) {
  return (
    <span class="c-maxbet-wrap">
      <span class="c-betlamps" aria-hidden="true">
        {[1, 2, 3].map((n) => (
          <i class={p.lit ? 'on' : ''} data-bet-lamp>
            {n}
          </i>
        ))}
      </span>
      <button type="button" class="c-maxbet" data-maxbet aria-label="MAX BET（レバーでも自動で賭けます）">
        MAX
        <br />
        BET
      </button>
    </span>
  );
}

/** 下皿（払い出しのメダルがたまる） */
export function MedalTray(p: { name: string; class?: string }) {
  return (
    <div class={`c-medal-tray${p.class ? ` ${p.class}` : ''}`} data-tray aria-hidden="true">
      <span class="c-medal-tray-name">{p.name}</span>
    </div>
  );
}
