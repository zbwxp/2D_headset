// visual — how things look (dot 1791550564, bowen 1791550635; docs/visual-plan.md): layout,
// panel items, buttons, icons, styles. It reads the data it is given and changes the drawing
// only through callbacks the app provides; it imports core's types and React, never the
// interaction package, and only the app imports it. No visual principles yet.
export { LayersPanel } from './LayersPanel'
export { PropertiesPanel } from './PropertiesPanel'
