// Types the API names that the kernel's boundary needs too.

/** An alignment along one axis: the shape's 'min' side, 'center' or 'max' side at the origin. */
export type AlignValue = 'min' | 'center' | 'max'
/** One alignment for every axis, or one per axis of three's (x, y up, z). */
export type Align3 = AlignValue | { x?: AlignValue; y?: AlignValue; z?: AlignValue }
/** One alignment for both axes of a sketch, or one per axis (its own x and y). */
export type Align2 = AlignValue | { x?: AlignValue; y?: AlignValue }
