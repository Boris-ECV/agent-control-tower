import { messages } from "./messages";

type Messages = typeof messages;

type Path<T, P extends string = ""> = T extends string
  ? P
  : T extends (...args: never[]) => string
    ? P
    : {
        [K in keyof T & string]: Path<T[K], P extends "" ? K : `${P}.${K}`>;
      }[keyof T & string];

type Leaf<T, P extends string> = P extends `${infer K}.${infer Rest}`
  ? K extends keyof T
    ? Leaf<T[K], Rest>
    : never
  : P extends keyof T
    ? T[P]
    : never;

export function t<P extends Path<Messages>>(key: P): Leaf<Messages, P> {
  const segments = key.split(".");
  let node: unknown = messages;
  for (const seg of segments) {
    node = (node as Record<string, unknown>)[seg];
  }
  return node as Leaf<Messages, P>;
}
