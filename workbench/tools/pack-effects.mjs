import {copyFile,mkdir,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {EMOTION_EFFECTS,EMOTION_EFFECT_THUMBS,emotionStyleModule,normalizeEmotionEffects,setEmotionEffectAxis} from './emotion-effect.mjs';

const dependencies = {
  'emotion-finals.js':'createFinalEmotionEffects',
  'emotion-kaomoji.js':'createKaomojiPainter',
  'wolf-kaomoji.js':'FIGURE_WOLF_KAOMOJI',
  'emotion-orb.js':'createOrbPainter',
  'emotion-particles.js':'createParticlePainter',
  'emotion-softglow.js':'createSoftGlowEmotionEffects',
  'emotion-softglow-field.js':null,
  'emotion-softglow-plan.js':null,
};
const variants = {
  kaomoji:{files:['emotion-kaomoji.js','wolf-kaomoji.js'], painter:'createKaomojiPainter,FIGURE_WOLF_KAOMOJI'},
  orb:{files:['emotion-orb.js'], painter:'createOrbPainter'},
  flow:{files:['emotion-particles.js'], painter:'createParticlePainter'},
  bubbles:{files:['emotion-particles.js'], painter:'createParticlePainter'},
  softglow:{files:['emotion-softglow.js','emotion-softglow-field.js','emotion-softglow-plan.js']},
};

/** The converter and the private install copy use the same selection and runtime. */
export async function writePackEffects(runtime, pack, manifest, value, size) {
  const styles = normalizeEmotionEffects(value);
  const selected = styles.filter(style=>style !== 'native');
  setEmotionEffectAxis(manifest,styles);
  const source = join(runtime,'backends','emotion-effects');
  const target = join(pack,'backends','emotion-effects');
  await mkdir(target,{recursive:true});
  await copyFile(join(source,'index.js'),join(target,'index.js'));
  await copyFile(join(source,'NOTICE.txt'),join(target,'NOTICE.txt'));
  const needed = new Set(selected.flatMap(style=>variants[style].files));
  if (selected.some(style=>variants[style].painter)) needed.add('emotion-finals.js');
  const imports = [];
  for (const [file,name] of Object.entries(dependencies)) {
    if (needed.has(file)) {
      await copyFile(join(source,file),join(target,file));
      if (name) imports.push(`import {${name}} from './${file}';`);
    } else await rm(join(target,file),{force:true});
  }
  const painters = selected.map(style=>{
    const {painter} = variants[style];
    return `${style}: ${painter ? `options => createFinalEmotionEffects(options, '${style}', ${painter})` : 'createSoftGlowEmotionEffects'}`;
  });
  const router = `${imports.join('\n')}\nconst painters = {${painters.join(',\n')}};\n`
    + `export function createEmotionEffects(options) {\n  const style = options.model.effectStyle;\n`
    + `  return Object.hasOwn(painters,style) ? painters[style](options) : {draw(){},trigger(){},dispose(){}};\n}\n`;
  await writeFile(join(target,'emotion-effects.js'),router,'utf8');
  await writeFile(join(pack,'backends','emotion-style.js'),emotionStyleModule(styles,size,manifest),'utf8');

  const thumbs = join(pack,EMOTION_EFFECT_THUMBS);
  if (selected.length) await mkdir(thumbs,{recursive:true});
  for (const style of EMOTION_EFFECTS) {
    const file = style + '.png';
    if (selected.length && styles.includes(style)) await copyFile(join(runtime,EMOTION_EFFECT_THUMBS,file),join(thumbs,file));
    else await rm(join(thumbs,file),{force:true});
  }
}
