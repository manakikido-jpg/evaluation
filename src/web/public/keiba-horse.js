/** 試作用の滑らかな馬体。外部モデルに依存せず、形状・走法を個別調整できる。 */
export function createHorse(T, horse) {
  const root = new T.Group(), body = new T.Group(); root.add(body);
  const coats = [0x38281f, 0x66321c, 0x1f1d1a, 0x9b9b91, 0x131616, 0x452a1c];
  const skin = new T.MeshStandardMaterial({ color: coats[horse.coat] ?? coats[0], roughness: .72, metalness: 0 });
  const coatCanvas=document.createElement('canvas');coatCanvas.width=256;coatCanvas.height=128;const cg=coatCanvas.getContext('2d');let grain=horse.no*55+9;
  for(let y=0;y<128;y++)for(let x=0;x<256;x++){grain=(Math.imul(grain,1664525)+1013904223)>>>0;const c=215+grain%35;cg.fillStyle=`rgb(${c},${c},${c})`;cg.fillRect(x,y,2,1);}
  const coatMap=new T.CanvasTexture(coatCanvas);coatMap.colorSpace=T.SRGBColorSpace;coatMap.wrapS=coatMap.wrapT=T.RepeatWrapping;coatMap.repeat.set(3,2);skin.map=coatMap;skin.bumpMap=coatMap;skin.bumpScale=.007;
  const dark = new T.MeshStandardMaterial({ color: 0x171412, roughness: .9 });
  const leather = new T.MeshStandardMaterial({ color: 0x302119, roughness: .78 });
  const hoof = new T.MeshStandardMaterial({ color: 0x292722, roughness: .65 });
  const silver = new T.MeshStandardMaterial({ color: 0xbdb7a7, roughness: .3, metalness: .55 });
  const silk = new T.MeshStandardMaterial({ color: horse.silk?.base ?? '#f1e8d6', roughness: .62 });
  const accent = new T.MeshStandardMaterial({ color: horse.silk?.accent ?? '#ad262d', roughness: .6 });
  const white = new T.MeshStandardMaterial({ color: 0xe4dfd2, roughness: .85 });
  function mesh(parent, geometry, material, x = 0, y = 0, z = 0, scale = [1, 1, 1]) {
    const m = new T.Mesh(geometry, material); m.position.set(x, y, z); m.scale.set(...scale); m.castShadow = true; m.receiveShadow = true; parent.add(m); return m;
  }
  const sphere = (p, m, x, y, z, sx, sy, sz) => mesh(p, new T.SphereGeometry(1, 16, 12), m, x, y, z, [sx, sy, sz]);
  /** 断面を連続補間した馬体。中心線/上下の厚さ/左右の厚さを指定する。 */
  function loft(parent, material, profile) {
    const centers = profile.map(p => new T.Vector3(p[0], p[1], p[2] ?? 0)), curve = new T.CatmullRomCurve3(centers);
    const positions = [], uv = [], index = [], count = 48, sides = 20;
    for (let i = 0; i <= count; i++) {
      const f = i / count, p = curve.getPoint(f), tangent = curve.getTangent(f).normalize();
      const side = new T.Vector3(0, 0, 1), up = new T.Vector3().crossVectors(side, tangent).normalize();
      const q = f * (profile.length - 1), a = Math.min(profile.length - 2, Math.floor(q)), t = q - a;
      const ry = T.MathUtils.lerp(profile[a][3], profile[a + 1][3], t), rz = T.MathUtils.lerp(profile[a][4], profile[a + 1][4], t);
      for (let j = 0; j <= sides; j++) {
        const angle = j / sides * Math.PI * 2, v = p.clone().addScaledVector(up, Math.cos(angle) * ry).addScaledVector(side, Math.sin(angle) * rz);
        positions.push(v.x, v.y, v.z); uv.push(f, j / sides);
        if (i < count && j < sides) { const k = i * (sides + 1) + j; index.push(k, k + 1, k + sides + 1, k + 1, k + sides + 2, k + sides + 1); }
      }
    }
    const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(positions, 3)); g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2)); g.setIndex(index); g.computeVertexNormals(); return mesh(parent, g, material);
  }
  loft(body, skin, [[-.98,1.37,0,.025,.025],[-.79,1.43,0,.29,.28],[-.44,1.39,0,.34,.34],[0,1.35,0,.38,.34],[.4,1.42,0,.33,.29],[.69,1.43,0,.22,.23],[.79,1.44,0,.025,.03]]);
  loft(body, skin, [[.43,1.38,0,.25,.23],[.69,1.65,0,.25,.22],[.85,1.95,0,.22,.17],[1.04,2.15,0,.14,.125],[1.17,2.16,0,.075,.08]]);
  const head = new T.Group(); head.position.set(1.06,2.14,0); head.rotation.z = -.38; body.add(head);
  loft(head, skin, [[-.12,.04,0,.08,.08],[.03,.025,0,.155,.12],[.22,-.02,0,.13,.105],[.45,-.08,0,.105,.085],[.62,-.12,0,.095,.095],[.66,-.12,0,.03,.04]]);
  sphere(head, skin, .16,-.075,0,.18,.12,.12);
  for (const sign of [-1, 1]) {
    const ear = sphere(head, skin, -.04,.24,sign*.075,.045,.17,.055); ear.rotation.z = -.2; ear.rotation.x = sign*.18;
    sphere(head, dark, -.015,.245,sign*.083,.018,.105,.036);
    sphere(head, dark, .16,.065,sign*.112,.028,.023,.012);
    sphere(head, white, .168,.072,sign*.121,.006,.006,.003);
    sphere(head, dark, .57,-.08,sign*.086,.042,.027,.009);
    const cheek = mesh(head, new T.TorusGeometry(.14,.012,5,24), leather, .16,0,0,[1,1,.82]); cheek.rotation.y = Math.PI/2;
    const bit = mesh(head, new T.TorusGeometry(.022,.006,5,12), silver,.49,-.17,sign*.102); bit.rotation.y = Math.PI/2;
  }
  loft(head, dark, [[.31,.055,0,.015,.025],[.49,-.005,0,.018,.028],[.59,-.06,0,.01,.016]]);
  for (let i = 0; i < 10; i++) {
    const f = i/9, x = .48 + f*.48, y = 1.73 + f*.5;
    const lock = sphere(body, dark, x,y,.015,.045,.13,.036); lock.rotation.z = -.45;
  }
  const tail = new T.Group(); tail.position.set(-.84,1.5,0); body.add(tail);
  loft(tail, dark, [[0,0,0,.06,.06],[-.2,-.12,0,.08,.055],[-.32,-.4,0,.055,.045],[-.43,-.72,0,.018,.018],[-.47,-.82,0,.002,.004]]);
  const saddle = sphere(body, leather, -.12,1.71,0,.37,.055,.28);
  const blanket = mesh(body, new T.BoxGeometry(.67,.045,.65), white,-.13,1.66,0); blanket.rotation.z = -.05;
  const panelMat = new T.MeshStandardMaterial({color:0xf3e7c6,roughness:.9});
  for (const sign of [-1,1]) {
    const p = mesh(body,new T.BoxGeometry(.63,.35,.018),panelMat,-.14,1.48,sign*.337); p.rotation.x = sign*.1;
    const canvas = document.createElement('canvas'); canvas.width=128; canvas.height=128;const ctx=canvas.getContext('2d');ctx.fillStyle='#f1e8d1';ctx.fillRect(0,0,128,128);ctx.fillStyle='#17221d';ctx.textAlign='center';ctx.font='bold 100px sans-serif';ctx.fillText(String(horse.no),64,102);
    const tex=new T.CanvasTexture(canvas);tex.colorSpace=T.SRGBColorSpace;
    const n=mesh(body,new T.PlaneGeometry(.25,.27),new T.MeshStandardMaterial({map:tex,roughness:.95}),-.12,1.48,sign*.35);n.rotation.y=sign*Math.PI/2;
    const girth=mesh(body,new T.BoxGeometry(.075,.48,.018),leather,.12,1.43,sign*.344);girth.rotation.x=sign*.12;
  }
  const legs=[];
  for (const back of [false,true]) for (const side of [-1,1]) {
    const upper=new T.Group();upper.position.set(back?-.64:.52,back?1.42:1.45,side*.225);body.add(upper);
    loft(upper,skin,[[0,.04,0,.12,.1],[back?-.07:.03,-.22,0,.115,.085],[back?-.09:.055,-.49,0,.055,.048],[.01,-.66,0,.04,.037]]);
    const lower=new T.Group();lower.position.set(.01,-.66,0);upper.add(lower);
    sphere(lower,skin,0,0,0,.055,.07,.05);
    loft(lower,skin,[[0,0,0,.035,.03],[.015,-.22,0,.028,.025],[.035,-.47,0,.026,.024],[.07,-.6,0,.043,.037]]);
    sphere(lower,skin,.06,-.57,0,.045,.06,.04);
    const foot=mesh(lower,new T.CylinderGeometry(.052,.073,.095,12),hoof,.095,-.67,0,[1.2,1,1]);foot.rotation.z=.12;
    legs.push({upper,lower,back,side});
  }
  const rider=new T.Group();rider.position.set(-.12,1.77,0);body.add(rider);
  // 騎手は鞍から腰を上げ、膝を曲げた競走姿勢。
  const torso=mesh(rider,new T.CapsuleGeometry(.105,.26,4,10),silk,.11,.32,0,[1,1,.87]);torso.rotation.z=-.9;
  sphere(rider,silk,-.08,.16,0,.125,.1,.115);
  sphere(rider,white,.37,.46,0,.078,.085,.07);
  sphere(rider,silk,.37,.52,0,.092,.065,.085);
  mesh(rider,new T.BoxGeometry(.1,.015,.15),silk,.43,.5,0);
  function bar(parent,material,a,b,r) {
    const p=new T.Vector3(...a),q=new T.Vector3(...b),d=q.clone().sub(p);
    const m=mesh(parent,new T.CapsuleGeometry(r,Math.max(.01,d.length()-r*2),3,8),material);m.position.copy(p.add(q).multiplyScalar(.5));m.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),d.normalize());return m;
  }
  for(const sign of [-1,1]) {
    bar(rider,white,[-.1,.16,sign*.08],[.17,-.05,sign*.24],.054);
    bar(rider,dark,[.17,-.05,sign*.24],[-.02,-.29,sign*.33],.036);
    bar(rider,silk,[.25,.4,sign*.07],[.36,.21,sign*.2],.038);
    bar(rider,silk,[.36,.21,sign*.2],[.62,.18,sign*.14],.03);
    sphere(rider,white,.62,.18,sign*.14,.032,.028,.03);
    bar(rider,leather,[.62,.18,sign*.14],[1.58,.2,sign*.1],.006);
    const stripe=mesh(rider,new T.BoxGeometry(.12,.018,.16),accent,.13,.35,0);stripe.rotation.z=-.9;
  }
  // 静的な部品を材質ごとにまとめ、8頭での描画呼出しを抑える。
  function mergeChildren(parent) {
    const byMaterial=new Map();
    for(const child of [...parent.children]) if(child.isMesh) {
      child.updateMatrix();
      const g=(child.geometry.index?child.geometry.toNonIndexed():child.geometry.clone()).applyMatrix4(child.matrix);
      if(!byMaterial.has(child.material))byMaterial.set(child.material,[]);
      byMaterial.get(child.material).push(g);parent.remove(child);child.geometry.dispose();
    }
    for(const [material,list] of byMaterial) {
      const g=new T.BufferGeometry();
      for(const key of ['position','normal','uv']) {
        const size=key==='uv'?2:3, total=list.reduce((n,p)=>n+p.attributes.position.count*size,0), all=new Float32Array(total);let offset=0;
        for(const part of list){const values=part.getAttribute(key)?.array??new Float32Array(part.attributes.position.count*size);all.set(values,offset);offset+=values.length;}
        g.setAttribute(key,new T.BufferAttribute(all,size));
      }
      mesh(parent,g,material);for(const old of list)old.dispose();
    }
  }
  for(const group of [body,head,tail,rider,...legs.flatMap(l=>[l.upper,l.lower])])mergeChildren(group);
  return { root, update(seconds, moving=true) {
    const phase=seconds*2.4*Math.PI*2+horse.no*.67, amount=moving?1:0;
    body.position.y=Math.cos(phase*2)*.045*amount;
    body.rotation.z=Math.sin(phase)*.016*amount;
    head.rotation.z=-.38+Math.sin(phase+.3)*.035*amount;
    tail.rotation.x=Math.sin(phase*.6)*.13; tail.rotation.z=Math.sin(phase)*.06;
    rider.position.y=1.77+Math.cos(phase*2+.8)*.035*amount;
    for(const leg of legs) {
      const p=phase+(leg.back?Math.PI*.95:0)+(leg.side===1?.65:0), swing=Math.sin(p);
      leg.upper.rotation.z=swing*(leg.back?.62:.7)*amount;
      leg.lower.rotation.z=(leg.back?1:-1)*Math.max(0,Math.cos(p-.4))*.95*amount;
    }
  } };
}
