// SPDX-License-Identifier: Apache-2.0
//
// NLib's region warp and flattening of a surface (nlib_shape.cpp): functions the kernel compiles out
// (`#if NLIB_UNUSED`), copied and renamed with a `smlibpy_` prefix. Their documentation is in
// nlib_shape.cpp; smlibpy calls them from shape_edit.cpp.

#pragma once

#include <nurbs.h>

// N_SrfShapeRegionWarp: warps surP over a polygon of its parameter space (NL_PREPARE, NL_INTERACT,
// NL_CLEANUP); surP's knots are refined in place, on SP (so surP must live on SP), the result goes to
// surQ on SQ.
NL_FLAG smlibpy_N_SrfShapeRegionWarp(NL_SURFACE* surP, NL_EPOLYGON* ppl, NL_INDEX npu, NL_INDEX npv, NL_INDEX ksu,
                                     NL_INDEX keu, NL_INDEX ksv, NL_INDEX kev, NL_SURFACE* surW, NL_VECTOR W,
                                     NL_SFUN* sfnD, NL_REAL d, NL_REAL tol, NL_FLAG flg, NL_FLAG ref, NL_REAL** tu,
                                     NL_REAL** tv, NL_INDEX* siu, NL_INDEX* eiu, NL_INDEX* siv, NL_INDEX* eiv,
                                     NL_BOOLEAN*** IN, NL_SURFACE* surQ, NL_STACKS* SP, NL_STACKS* SQ);

// N_SrfShapeFlatten: maps the control points local to a polygon of the parameter space (with `stf`
// NL_YES only those on the `lor` side of the plane) onto a plane along W; the result goes to surQ on SQ.
NL_FLAG smlibpy_N_SrfShapeFlatten(NL_SURFACE* surP, NL_EPOLYGON* ppl, NL_INDEX npu, NL_INDEX npv, NL_INDEX ksu,
                                  NL_INDEX keu, NL_INDEX ksv, NL_INDEX kev, NL_PLANE* pln, NL_VECTOR W, NL_REAL tol,
                                  NL_FLAG stf, NL_FLAG lor, NL_FLAG ref, NL_SURFACE* surQ, NL_STACKS* SP, NL_STACKS* SQ);

// N_SrfShapeCreateRatBasis: the bivariate rational basis function the region warp moves control points by.
NL_FLAG smlibpy_N_SrfShapeCreateRatBasis(NL_REAL wpq, NL_DEGREE p, NL_DEGREE q, NL_SFUN* sfn, NL_FLAG flg,
                                         NL_STACKS* SG);
