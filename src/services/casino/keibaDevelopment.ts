/** 育成は各項目20まで、スキル2枠。速さ以外の追加効果は合計1.2%まで。 */
export const TRAINING = { speed:'スピード', stamina:'スタミナ', start:'スタート', power:'パワー', settle:'折り合い' } as const;
export type TrainingKind = keyof typeof TRAINING;
export const SKILLS = {
  dash:{name:'二の脚',kind:'start',note:'発走後10%まで',threshold:3},
  calm:{name:'折り合い上手',kind:'settle',note:'中盤20〜70%',threshold:3},
  long:{name:'長くいい脚',kind:'stamina',note:'残り30%から',threshold:3},
  heavy:{name:'重馬場巧者',kind:'power',note:'稍重・重馬場',threshold:3},
  grit:{name:'勝負根性',kind:'speed',note:'残り10%から',threshold:3},
} as const;
export type Skill = keyof typeof SKILLS;
export type Development = { points:Partial<Record<TrainingKind,number>>; skills:Skill[]; history:{at:string;kind:TrainingKind|'rest';cost:number}[] };
export const EMPTY_DEVELOPMENT:Development={points:{},skills:[],history:[]};
export const isTraining=(v:unknown):v is TrainingKind=>typeof v==='string'&&Object.hasOwn(TRAINING,v);
export const isSkill=(v:unknown):v is Skill=>typeof v==='string'&&Object.hasOwn(SKILLS,v);
export function development(v:Development|undefined|null):Development {
  const points:Development['points']={};
  for(const k of Object.keys(TRAINING) as TrainingKind[])points[k]=Math.min(20,Math.max(0,Math.floor(v?.points?.[k]??0)));
  return {points,skills:[...new Set(v?.skills??[])].filter(isSkill).slice(0,2),history:(v?.history??[]).slice(0,30)};
}
export const unlocked=(d:Development,k:Skill)=>(d.points[SKILLS[k].kind]??0)>=SKILLS[k].threshold;
export function trained(v:Development,kind:TrainingKind|'rest',cost:number,now:Date):Development {
  const d=development(v);if(kind!=='rest')d.points[kind]=Math.min(20,(d.points[kind]??0)+1);
  d.history=[{at:now.toISOString(),kind,cost},...d.history].slice(0,30);return d;
}
/** 元の速さの育成と別枠。条件付き効果を足しても+1.2%を超えない。 */
export function growthMultiplier(v:Development|undefined,race:{going:number},phase:number):number {
  if(!v)return 1;
  const p=v.points;
  let boost=(phase<.1?(p.start??0)*.00015:0)+(phase>.7?(p.stamina??0)*.0001:0)+(race.going>0?(p.power??0)*.0001:0)+(phase>.2&&phase<.7?(p.settle??0)*.0001:0);
  for(const skill of v.skills??[]){
    if(!isSkill(skill)||!unlocked(v,skill))continue;
    if(skill==='dash'&&phase<.1||skill==='calm'&&phase>.2&&phase<.7||skill==='long'&&phase>.7||skill==='heavy'&&race.going>0||skill==='grit'&&phase>.9)boost+=.003;
  }
  return 1+Math.min(.012,Math.max(0,boost));
}
/** 父母双方が持つものを優先し、1つだけ素質を継ぐ。装備は本人が選ぶ。 */
export function inherited(a:Development|undefined,b:Development|undefined):Development {
  const da=development(a),db=development(b),out=development(null);
  const common=da.skills.find(k=>db.skills.includes(k))??da.skills[0]??db.skills[0];
  if(common)out.points[SKILLS[common].kind]=1;
  return out;
}
