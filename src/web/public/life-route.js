/** 選んだ数のマスが街をめぐる一本の道。距離をそろえて、急な曲がりでも駒が道を走る。 */
export function createLifeRoute(T,count=36) {
  const anchors=[[-11,10],[-12,4],[-10,-2],[-12,-8],[-7,-11],[0,-10],[7,-11],[12,-7],[11,-1],[6,-3],[1,-4],[-4,-2],[-5,3],[-1,5],[4,3],[9,5],[11,10],[5,12],[0,10]];
  const curve=new T.CatmullRomCurve3(anchors.map(([x,z])=>new T.Vector3(x,0,z)),false,'centripetal');
  curve.arcLengthDivisions=1500;
  const goal=count-1;
  const point=cell=>curve.getPointAt(Math.max(0,Math.min(goal,cell))/goal);
  const tangent=cell=>curve.getTangentAt(Math.max(0,Math.min(goal,cell))/goal);
  return {point,tangent,centers:Array.from({length:count},(_,n)=>point(n))};
}
