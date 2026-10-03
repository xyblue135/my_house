import type { ObjectDirective } from 'vue'

type DialogElement = HTMLElement & { disposeDialog?: () => void; closeDialog?: () => void }
const stack: HTMLElement[] = []
const focusable =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]'

/** Keep keyboard focus in the topmost sheet and restore it when the sheet closes. */
export const dialog: ObjectDirective<DialogElement, () => void> = {
  mounted(el, binding) {
    const previous = document.activeElement as HTMLElement | null
    el.closeDialog = binding.value
    el.setAttribute('role', 'dialog')
    el.setAttribute('aria-modal', 'true')
    el.tabIndex = -1
    stack.push(el)
    function onKey(event: KeyboardEvent) {
      if (stack.at(-1) !== el) return
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        el.closeDialog?.()
        return
      }
      if (event.key !== 'Tab') return
      const targets = Array.from(el.querySelectorAll<HTMLElement>(focusable)).filter(
        (node) => node.getClientRects().length && !node.closest('[inert]'),
      )
      const first = targets[0],
        last = targets.at(-1)
      if (!first) {
        event.preventDefault()
        el.focus()
        return
      }
      if (
        event.shiftKey &&
        (document.activeElement === first ||
          document.activeElement === el ||
          !el.contains(document.activeElement))
      ) {
        event.preventDefault()
        last?.focus()
      } else if (
        !event.shiftKey &&
        (document.activeElement === last ||
          document.activeElement === el ||
          !el.contains(document.activeElement))
      ) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKey, true)
    // Focusing the sheet avoids opening the mobile keyboard before the user chooses a field.
    el.focus({ preventScroll: true })
    el.disposeDialog = () => {
      document.removeEventListener('keydown', onKey, true)
      stack.splice(stack.indexOf(el), 1)
      if (previous?.isConnected) previous.focus({ preventScroll: true })
    }
  },
  updated(el, binding) {
    el.closeDialog = binding.value
  },
  beforeUnmount(el) {
    el.disposeDialog?.()
  },
}
