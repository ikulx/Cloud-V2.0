import { Node, mergeAttributes } from '@tiptap/core'

/**
 * Callout-Block "Wichtig". Optisch wie ein Zitat, aber in Rot + Warn-Icon,
 * um auf kritische Inhalte aufmerksam zu machen.
 *
 * Inhalt = beliebige Blocks (inkl. Listen, weitere Überschriften etc.).
 */
export const ImportantBlock = Node.create({
  name: 'importantBlock',
  group: 'block',
  content: 'block+',
  defining: true,

  parseHTML() {
    return [{ tag: 'div[data-type="important"]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, { 'data-type': 'important', class: 'wiki-important' }),
      0,
    ]
  },
})
