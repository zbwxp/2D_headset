// feedback — turns what core refused (a Refusal: code, message, objects as kind + id) into
// a description to show. Shared by every flow; drawing it is the view's (doc 22 §3.3).
import { Refusal, type RefusalObject } from '../src'

export interface Feedback { code: string; message: string; objects: RefusalObject[] }

/** A core refusal (or any other error) as feedback; nobody parses the message. */
export function fromError(err: unknown): Feedback {
  const r = err instanceof Refusal ? err : null
  return { code: r?.code ?? 'error', message: (err as Error).message, objects: r ? [...r.objects] : [] }
}

/** Feedback interaction itself gives (a step that cannot go on), in the same shape. */
export const note = (code: string, message: string, objects: RefusalObject[] = []): Feedback => ({ code, message, objects })
