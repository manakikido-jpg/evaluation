import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const script = readFileSync(new URL('../src/web/public/office-actions.js', import.meta.url), 'utf8');
function browser({ fail = false, native = false, confirmed = true, specialized = false, statusCode = 400, errorText = '', parseError = false } = {}) {
  const events = new Map<string, Function>();
  const button = {disabled: false};
  class Form {
    method = 'post'; target = ''; action = 'https://office.test/ranks'; elements = [button];
    attrs = new Map();
    querySelector = () => native ? {} : null;
    closest = () => null;
    getAttribute = (k: string) => k === 'action' ? '/ranks' : null;
    setAttribute = (k: string, v: string) => this.attrs.set(k, v);
    removeAttribute = (k: string) => this.attrs.delete(k);
  }
  const form = new Form();
  const main = { contains: () => true, hasAttribute: () => !specialized, querySelectorAll: () => [] };
  const status = {textContent:'',className:''};
  const fetch = vi.fn(async (..._args: unknown[]) => { if (fail) throw Error('network'); return {ok:statusCode < 400, status:statusCode, url:'https://office.test/ranks', text:async()=>'response'}; });
  const document = {
    getElementById: (id: string) => id === 'main-content' ? main : status,
    addEventListener: (k: string, f: Function) => events.set(k, f),
  };
  const append = vi.fn();
  runInNewContext(script, { document, HTMLFormElement:Form, FormData:class {append=append;}, URL,
    location:{href:'https://office.test/ranks',origin:'https://office.test',pathname:'/ranks'},
    DOMParser:class {parseFromString(){if(parseError)throw Error('DOM parse');return {querySelector:()=>errorText?{textContent:errorText}:null};}},
    fetch, AbortController, setTimeout, clearTimeout });
  const event = {target:form,defaultPrevented:!confirmed,preventDefault:vi.fn(),submitter:{name:'save',value:'yes',hasAttribute:()=>false}};
  return {form,button,status,fetch,append,event,submit:()=>events.get('submit')!(event)};
}
describe('社務所のその場送信', () => {
  it('POSTは一度だけ送り、通信失敗時は入力を残して状態を知らせる', async () => {
    const b = browser({fail:true});
    await b.submit();
    expect(b.fetch).toHaveBeenCalledTimes(1);
    expect(b.fetch.mock.calls[0]![1]).toMatchObject({method:'POST',credentials:'same-origin'});
    expect(b.append).toHaveBeenCalledWith('save','yes');
    expect(b.status.textContent).toContain('二重送信を避けるため');
    expect(b.button.disabled).toBe(false);
    expect(b.form.attrs.has('aria-busy')).toBe(false);
  });
  it('HTTP400の入力エラーを通信エラーへ置き換えず、理由をそのまま表示する', async () => {
    const b=browser({statusCode:400,errorText:'1 行目のスタンプが読めません。'});await b.submit();
    expect(b.status.textContent).toBe('1 行目のスタンプが読めません。');
    expect(b.status.textContent).not.toContain('通信を確認');expect(b.fetch).toHaveBeenCalledTimes(1);
    expect(b.button.disabled).toBe(false);expect(b.form.attrs.has('aria-busy')).toBe(false);
  });
  it('403やサーバー障害の本文が通常HTMLでなくても再送しない', async () => {
    for(const code of [403,500]){
      const b=browser({statusCode:code});await b.submit();expect(b.fetch).toHaveBeenCalledTimes(1);
      expect(b.status.textContent).toContain(code===403?'権限やログイン':'HTTP 500');
      expect(b.status.textContent).not.toContain('通信を確認');expect(b.button.disabled).toBe(false);
    }
  });
  it('受信後の画面更新失敗を通信切断と区別する', async () => {
    const b=browser({statusCode:200,parseError:true});await b.submit();
    expect(b.status.textContent).toContain('応答を受信しました');expect(b.fetch).toHaveBeenCalledTimes(1);
    expect(b.button.disabled).toBe(false);
  });
  it('連打中は二つ目のPOSTを送らない', async () => {
    const b = browser();
    const first = b.submit(); await b.submit(); await first;
    expect(b.fetch).toHaveBeenCalledTimes(1);
  });
  it('確認をやめた操作・ファイル送信・専用画面は横取りしない', async () => {
    for (const options of [{confirmed:false},{native:true},{specialized:true}]) {
      const b=browser(options); await b.submit();
      expect(b.fetch).not.toHaveBeenCalled();
      expect(b.event.preventDefault).not.toHaveBeenCalled();
    }
  });
});
