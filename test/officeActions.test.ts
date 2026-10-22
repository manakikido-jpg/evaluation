import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const script = readFileSync(new URL('../src/web/public/office-actions.js', import.meta.url), 'utf8');
function browser({ fail = false, native = false, confirmed = true, specialized = false } = {}) {
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
  const fetch = vi.fn(async (..._args: unknown[]) => { if (fail) throw Error('network'); return {ok:false}; });
  const document = {
    getElementById: (id: string) => id === 'main-content' ? main : status,
    addEventListener: (k: string, f: Function) => events.set(k, f),
  };
  const append = vi.fn();
  runInNewContext(script, { document, HTMLFormElement:Form, FormData:class {append=append;}, URL,
    location:{href:'https://office.test/ranks',origin:'https://office.test',pathname:'/ranks'},
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
