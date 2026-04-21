import type { ErzeugerCategory, ErzeugerCategoryWithTypes, ErzeugerType } from './queries'

/** Liefert die Pfad-Kette von der Wurzel bis zum Knoten (inkl. Knoten). */
export function getCategoryPath(
  catId: string | null,
  all: ErzeugerCategory[],
): ErzeugerCategory[] {
  const path: ErzeugerCategory[] = []
  const seen = new Set<string>()
  let cursor: string | null = catId
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor)
    const cat = all.find((c) => c.id === cursor)
    if (!cat) break
    path.unshift(cat)
    cursor = cat.parentId
  }
  return path
}

/** Formatiert den Pfad als "Kategorie › Unterordner › …" */
export function formatCategoryPath(
  catId: string | null,
  all: ErzeugerCategory[],
  sep = ' › ',
): string {
  return getCategoryPath(catId, all).map((c) => c.name).join(sep)
}

/** Formatiert einen Typ komplett: "Kategorie › Typname". */
export function formatTypeLabel(
  type: { id: string; name: string; categoryId: string | null },
  categories: ErzeugerCategory[],
): string {
  const path = formatCategoryPath(type.categoryId, categories)
  return path ? `${path} › ${type.name}` : type.name
}

/** Baut eine flache Liste aller Typen über alle Kategorien – für Suche. */
export function flattenTypes(cats: ErzeugerCategoryWithTypes[]): ErzeugerType[] {
  return cats.flatMap((c) => c.types)
}

interface TreeNode {
  category: ErzeugerCategory
  children: TreeNode[]
  types: ErzeugerType[]
}

/** Baut aus der flachen Kategorie-Liste den Baum mit Kindknoten und zugehörigen Typen. */
export function buildCategoryTree(cats: ErzeugerCategoryWithTypes[]): TreeNode[] {
  const byId = new Map<string, TreeNode>()
  for (const c of cats) byId.set(c.id, { category: c, children: [], types: c.types })
  const roots: TreeNode[] = []
  for (const node of byId.values()) {
    if (node.category.parentId && byId.has(node.category.parentId)) {
      byId.get(node.category.parentId)!.children.push(node)
    } else {
      roots.push(node)
    }
  }
  const sortRec = (list: TreeNode[]) => {
    list.sort((a, b) =>
      a.category.sortOrder - b.category.sortOrder || a.category.name.localeCompare(b.category.name),
    )
    list.forEach((n) => sortRec(n.children))
  }
  sortRec(roots)
  return roots
}

export type ErzeugerTreeNode = TreeNode
