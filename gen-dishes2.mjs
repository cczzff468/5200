import ZAI from 'z-ai-web-dev-sdk';
import fs from 'fs';

const OUT = '/tmp/mtimg/gen';
fs.mkdirSync(OUT, { recursive: true });
const SHARD = Number(process.argv[2] || 0);
const SHARDS = 2;

const P = '美食摄影特写，白色浅色背景，光线明亮，食欲感，高清真实照片，画面中不要出现任何文字水印';
const jobs = [
  ['soymilk', '现磨豆浆一杯热气腾腾，白色瓷杯装'],
  ['suancai-noodle', '酸菜肉丝面，一碗热汤面配酸菜肉丝，白瓷碗'],
  ['egg-tart', '葡式蛋挞两个，酥皮金黄蛋液饱满'],
  ['cola', '冰镇可乐易拉罐带水珠'],
  ['sundae', '黑糖珍珠圣代杯装冰淇淋甜品'],
  ['milkshake', '草莓奶昔杯装粉色奶昔顶部奶油'],
  ['beefroll', '火锅肥牛卷生鲜盘装红白相间肉片'],
  ['kuanfen', '红薯宽粉火锅食材，干宽粉丝束'],
  ['quail-egg', '剥壳鹌鹑蛋一盘小巧圆润'],
  ['luncheon-meat', '午餐肉切片摆盘粉色方片'],
  ['suanmeitang', '冰镇酸梅汤一杯深褐色中式饮品加冰块'],
  ['mandarin', '新鲜沙糖桔一堆带叶橘子水果'],
  ['cherry', '新鲜车厘子深红水果一碗'],
  ['kiwi', '猕猴桃切开的绿果肉水果'],
  ['fruit-mix', '水果捞杯装混合水果酸奶'],
  ['banana', '一把新鲜黄色香蕉'],
  ['milk', '盒装纯牛奶白色包装产品图'],
  ['chips', '桶装薯片零食金黄薯片'],
  ['latiao', '辣条麻辣零食红色条状'],
  ['tissue', '抽纸一盒白色纸巾'],
  ['eggs', '新鲜生鸡蛋一盘浅褐色鸡蛋'],
  ['huoxiang', '藿香正气水小玻璃瓶药品十支装'],
  ['mask', '蓝色医用外科口罩产品图'],
  ['bandaid', '创可贴肉色透气胶布产品图'],
  ['vitamin-c', '维生素C咀嚼片橙色药片药瓶'],
  ['durian-pizza', '榴莲比萨披萨铺满榴莲果肉'],
  ['shrimp', '黄金蝴蝶虾炸虾美食金黄酥脆'],
  ['tomato-rice', '番茄鸡蛋盖浇饭白米饭浇头'],
  ['potato-rice', '酸辣土豆丝盖浇饭白米饭配土豆丝'],
  ['seaweed-soup', '紫菜蛋花汤一碗清汤'],
  ['maodu', '火锅新鲜毛肚黑色叶片状食材'],
  ['xiahua', '手打虾滑火锅食材粉色虾滑'],
  ['potato-slice', '薄切土豆片火锅食材一盘'],
  ['frozen-tofu', '冻豆腐火锅食材多孔豆腐块'],
  ['youtiao', '现炸油条两根金黄酥脆早餐'],
].filter((_, i) => i % SHARDS === SHARD);

const todo = jobs.filter(([k]) => !fs.existsSync(`${OUT}/${k}.png`));
console.log(`shard=${SHARD} todo=${todo.length}`);

const zai = await ZAI.create();
for (const [key, prompt] of todo) {
  let ok = false;
  for (let a = 1; a <= 5 && !ok; a++) {
    try {
      const r = await zai.images.generations.create({ prompt: `${prompt}，${P}`, size: '1024x1024' });
      const b64 = r?.data?.[0]?.base64;
      if (!b64) throw new Error('empty base64');
      fs.writeFileSync(`${OUT}/${key}.png`, Buffer.from(b64, 'base64'));
      console.log(`OK ${key}`);
      ok = true;
    } catch (e) {
      console.log(`retry${a} ${key}: ${String(e?.message || e).slice(0, 100)}`);
      await new Promise((s) => setTimeout(s, 6000 * a));
    }
  }
  if (!ok) console.log(`FAIL ${key}`);
  await new Promise((s) => setTimeout(s, 1500));
}
console.log(`SHARD${SHARD}_DONE`);
