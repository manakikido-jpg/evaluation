/** 選んだ数のマスが街をめぐる一本の道。距離をそろえて、急な曲がりでも駒が道を走る。 */
export function createLifeRoute(T,count=36,forks=[]) {
  const anchors=[[-11,10],[-12,4],[-10,-2],[-12,-8],[-7,-11],[0,-10],[7,-11],[12,-7],[11,-1],[6,-3],[1,-4],[-4,-2],[-5,3],[-1,5],[4,3],[9,5],[11,10],[5,12],[0,10]];
  const curve=new T.CatmullRomCurve3(anchors.map(([x,z])=>new T.Vector3(x,0,z)),false,'centripetal');
  curve.arcLengthDivisions=1500;
  const goal=count-1;
  const basePoint=cell=>curve.getPointAt(Math.max(0,Math.min(goal,cell))/goal);
  const point=(cell,branch)=>{
    const p=basePoint(cell);
    if(!branch || !forks.includes(branch.start) || !['steady','venture'].includes(branch.kind) || cell<branch.start || cell>branch.start+8)return p;
    const direction=curve.getTangentAt(Math.max(0,Math.min(goal,cell))/goal);
    const offset=Math.sin((cell-branch.start)/8*Math.PI)**2*1.6*(branch.kind==='steady'?-1:1);
    return p.add(new T.Vector3(direction.z*offset,0,-direction.x*offset));
  };
  const tangent=(cell,branch)=>branch?point(Math.min(goal,cell+.001),branch).sub(point(Math.max(0,cell-.001),branch)).normalize():curve.getTangentAt(Math.max(0,Math.min(goal,cell))/goal);
  const centers=Array.from({length:count},(_,n)=>point(n));
  const nearby=[...centers];for(const start of forks)for(let n=start;n<=start+8;n++)for(const kind of ['steady','venture'])nearby.push(point(n,{start,kind}));
  return {point,tangent,centers,nearby,forks};
}
