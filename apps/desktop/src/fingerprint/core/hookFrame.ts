// src/fingerprint/core/hookFrame.ts
/**
 * 覆盖属性的通用框架。
 *
 * 两条铁律：
 * 1. **装不上就返回 false，绝不抛**。第三方页里什么都有：被冻结的对象、不可配置的 getter、
 *    跨域访问即抛的属性。一个属性装不上只能让那一项失效，不能连累其它项（R9 逐项独立）。
 * 2. **记住"自己人"**。我们伪造出来的对象/副本再流回我们自己的 hook 时会被再加工一遍——
 *    canvas 副本的像素会被加两次噪声。用 WeakSet 认人，见到自己人直接放行。
 */
const ours = new WeakSet<object>()

/** 登记为"我们造出来的东西"；后续 hook 见到它就绕开。 */
export function markOurs<T extends object>(v: T): T {
  ours.add(v)
  return v
}

export function isOurs(v: unknown): boolean {
  return typeof v === 'object' && v !== null && ours.has(v as object)
}

/**
 * 用 `defineProperty` 覆盖 `target[prop]`。返回**是否装上**，不抛。
 *
 * `make(orig, rand)` 吃的是覆盖前的值（可能是继承来的 getter 的返回值），返回新值。
 * 新值若是对象/函数，自动登记为自己人。
 */
export function installHook<T>(
  target: object,
  prop: string,
  make: (orig: T, rand: () => number) => T,
  rand: () => number
): boolean {
  try {
    const desc = Object.getOwnPropertyDescriptor(target, prop)
    if (desc && desc.configurable === false) return false
    const orig = (target as Record<string, unknown>)[prop] as T
    const next = make(orig, rand)
    if (next !== null && (typeof next === 'object' || typeof next === 'function')) {
      ours.add(next as unknown as object)
    }
    Object.defineProperty(target, prop, {
      value: next,
      writable: true,
      configurable: true,
      enumerable: desc ? desc.enumerable !== false : true
    })
    return true
  } catch {
    return false
  }
}
