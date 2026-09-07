/**
 * UUID v4 generator kept byte-for-byte compatible with the mini-program SDK's `guid` shape.
 * It intentionally uses Math.random so it also works in the JavaScript runtimes bundled by App.
 */
export function guid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (character) => {
    const random = (Math.random() * 16) | 0
    const value = character === 'x' ? random : (random & 0x3) | 0x8
    return value.toString(16)
  })
}
