import { DocumentError } from './model.js';
export const AUDIO_MAX_BYTES=20*1024*1024;
export type DocumentTranscriber={model:string;transcribe:(file:File)=>Promise<string>};
export function checkAudio(file:unknown):asserts file is File{
  if(!(file instanceof File)||!file.size||file.size>AUDIO_MAX_BYTES||!/^.+\.(mp3|m4a|wav|webm|ogg|flac|mp4|mpeg|mpga)$/i.test(file.name))throw new DocumentError('20MB以下の音声ファイルを選んでください（MP3・M4A・WAV・WebM・OGG・FLAC・MP4など）。');
}
export function createDocumentTranscriber(apiKey:string|undefined,model='gpt-4o-mini-transcribe',request:typeof fetch=fetch):DocumentTranscriber|undefined{
  if(!apiKey)return undefined;
  return {model,async transcribe(file){
    checkAudio(file);
    try{
      const form=new FormData();form.set('file',file,file.name);form.set('model',model);form.set('response_format','json');
      const res=await request('https://api.openai.com/v1/audio/transcriptions',{method:'POST',headers:{Authorization:`Bearer ${apiKey}`},body:form,signal:AbortSignal.timeout(90000)});
      if(!res.ok)throw Error('upstream');const raw=await res.text();if(raw.length>300000)throw Error('size');const result=JSON.parse(raw) as {text?:unknown};
      if(typeof result.text!=='string'||!result.text.trim())throw Error('empty');
      if(result.text.trim().length>20000)throw new DocumentError('文字起こしが20,000文字を超えました。音声を分けて作成してください。');
      return result.text.trim().replace(/\r\n/g,'\n');
    }catch(e){if(e instanceof DocumentError)throw e;throw new DocumentError('音声を文字にできませんでした。音声の形式・長さ・連携設定を確認して、作成し直してください。',503);}
  }};
}
