import { z } from 'zod';
export const DOCUMENT_ROOT = '/minutes/documents';
export const itemKinds = ['decision', 'pending', 'action', 'note'] as const;
export const kindLabel: Record<typeof itemKinds[number], string> = {decision:'決定事項',pending:'保留・未確定',action:'次の作業',note:'参考・補足'};
const lines = z.array(z.number().int().positive()).max(20);
export const documentBodySchema = z.object({
  summary: z.string().max(2000),
  items: z.array(z.object({kind:z.enum(itemKinds),title:z.string().min(1).max(120),text:z.string().min(1).max(2000),lines}).strict()).max(80),
  qa: z.array(z.object({q:z.string().min(1).max(200),a:z.string().min(1).max(2000),lines}).strict()).max(60),
  steps: z.array(z.object({title:z.string().min(1).max(120),text:z.string().max(500),lines}).strict()).max(12),
}).strict();
export type DocumentBody = z.infer<typeof documentBodySchema>;
export const emptyDocument = (): DocumentBody => ({summary:'',items:[],qa:[],steps:[]});
export class DocumentError extends Error {constructor(message:string,public status:400|403|404|409|429|503=400){super(message);}}
export const sourceSchema=z.object({title:z.string().trim().min(1).max(120),source:z.string().trim().min(1).max(20000),nonce:z.string().uuid()}).strict();
export function checkedBody(input:unknown,source:string,generated=false):DocumentBody{
  const got=documentBodySchema.safeParse(input);
  if(!got.success||JSON.stringify(input).length>180000)throw new DocumentError('資料の文字数や項目を確認してください。');
  const max=source.split('\n').length;
  for(const row of [...got.data.items,...got.data.qa,...got.data.steps]){
    if(row.lines.some(n=>n>max)||(generated&&!row.lines.length))throw new DocumentError('原文の参照行を確認できません。資料の内容を見直してください。');
    row.lines=[...new Set(row.lines)].sort((a,b)=>a-b);
  }
  return got.data;
}
export function documentMarkdown(title:string,source:string,body:DocumentBody):string{
  const ref=(numbers:number[])=>numbers.length?`\n\n原文参照：${numbers.map(n=>`L${n}`).join('・')}（編集後は再照合してください）`:'';
  const out=[`# ${title}`,'','下書き・内容の確認が必要です。資料の編集では制度や設定は変わりません。','',body.summary];
  for(const kind of itemKinds){const rows=body.items.filter(x=>x.kind===kind);if(rows.length)out.push('',`## ${kindLabel[kind]}`,...rows.flatMap(x=>['',`### ${x.title}`,'',x.text+ref(x.lines)]));}
  if(body.steps.length)out.push('','## 流れ（順序を確認してください）',...body.steps.flatMap((s,i)=>['',`${i+1}. ${s.title}`,'',s.text+ref(s.lines)]));
  if(body.qa.length)out.push('','## Q&A',...body.qa.flatMap((q,i)=>['',`### Q${i+1} ${q.q}`,'',q.a+ref(q.lines)]));
  out.push('','## 元の議事録','',...source.split('\n').map((s,i)=>`L${i+1}: ${s}`));return out.join('\n');
}
