/** Поверхностное сравнение объектов одного типа: Date — по значению, остальное — по ===. */
export function shallowEqual<T extends object>(a: T, b: T): boolean {
  return (Object.keys(a) as (keyof T)[]).every((k) => {
    const av = a[k];
    const bv = b[k];
    return av instanceof Date && bv instanceof Date ? av.getTime() === bv.getTime() : av === bv;
  });
}
