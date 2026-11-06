/** 本人/サーバーのミュートを両方見る。状態不明を非ミュートとみなさない。 */
export function isEvaluationUnmuted(voice: {
  mute?: boolean|null; deaf?: boolean|null;
  selfMute?: boolean|null; serverMute?: boolean|null; selfDeaf?: boolean|null; serverDeaf?: boolean|null;
}): boolean {
  const flags=[voice.mute,voice.deaf,voice.selfMute,voice.serverMute,voice.selfDeaf,voice.serverDeaf];
  if(flags.some(v=>v===true))return false;
  return voice.mute===false&&voice.deaf===false||
    [voice.selfMute,voice.serverMute,voice.selfDeaf,voice.serverDeaf].every(v=>v===false);
}
