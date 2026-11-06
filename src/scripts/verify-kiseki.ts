import {verifyKiseki} from '../services/casino/kiseki/verification.js';
const args=new Map(process.argv.slice(2).map(argument=>{const [flag,value]=argument.split('=',2);return [flag!,value] as const;}));
try{
 const mode=args.get('--mode')??'assist';if(!['assist','timing','legacy'].includes(mode))throw Error('modeはassist/timing/legacyから選んでください。');
 const result=verifyKiseki({games:Number(args.get('--games')??1000),draws:Number(args.get('--draws')??100000),seed:Number(args.get('--seed')??20261106),mode:mode as 'assist'|'timing'|'legacy'});
 process.stdout.write(JSON.stringify(result,null,2)+'\n');
}catch(error){process.stderr.write((error instanceof Error?error.message:'検証条件を確認してください。')+'\n');process.exitCode=1;}
