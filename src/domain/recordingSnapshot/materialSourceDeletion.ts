import type {SnapshotMaterialRecipeRegistry} from './materialRestriction';
import type {SnapshotAngleGraph,SnapshotScalarPropertyTarget} from './model';

/** Source deletion uses the same target predicate as native property responses.
 * Keep each recipe's live geometric support and unrelated scalar fields intact. */
export function pruneSnapshotMaterialPropertyReferences(graph:SnapshotAngleGraph,activeTarget:(target:SnapshotScalarPropertyTarget)=>boolean):SnapshotAngleGraph {
 const prune=(registry:SnapshotMaterialRecipeRegistry|undefined):SnapshotMaterialRecipeRegistry|undefined=>{
  if(!registry)return registry;
  let changed=false;
  const entries=Object.entries(registry).map(([id,recipe])=>{
   let recipeChanged=false;
   const terms=recipe.terms.map(term=>{
    const properties=term.field.properties.filter(property=>activeTarget(property.target));
    if(properties.length===term.field.properties.length)return term;
    recipeChanged=true;return {...term,field:{...term.field,properties}};
   });
   changed ||= recipeChanged;return [id,recipeChanged?{...recipe,terms}:recipe] as const;
  });
  return changed?Object.fromEntries(entries):registry;
 };
 const materialRecipes=prune(graph.materialRecipes),materialBasisRecipes=prune(graph.materialBasisRecipes);
 return materialRecipes===graph.materialRecipes&&materialBasisRecipes===graph.materialBasisRecipes?graph:{...graph,...graph.materialRecipes?{materialRecipes}:{},...graph.materialBasisRecipes?{materialBasisRecipes}:{}};
}
