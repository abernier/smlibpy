// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0
//
// smlibpy: NLib's region warp and flattening of a surface, with the functions they call, copied from
// the SMLib sources of usd-brep (release 1.0.0, commit c9c5979), where they are compiled out: they sit
// in `#if NLIB_UNUSED` blocks, and nothing defines NLIB_UNUSED. They compile against today's headers as
// they are. smlibpy's wrappers are in shape_edit.cpp (Shell.warp, Shell.flatten).
//
// Modified by AWV Informatik AG (Apache License 2.0, section 4(b)); each change is marked
// `smlibpy patch`:
// - Every function here is renamed with a `smlibpy_` prefix (the macros below), and those not called
//   from outside this file have internal linkage: nothing here can clash with the kernel's own
//   definitions should a later kernel compile them in.
// - N_PtsAreInPolygon counts an edge as crossing a row's ray where one end lies above the ray and the
//   other does not; upstream it took one end above and the other below the ray plus NL_MTOL, so that both
//   edges at a vertex less than NL_MTOL above the ray counted, and a row through two vertices of the
//   polygon (the middle row of a circle's polygon) came out as outside it: a warp over a circle sank its
//   ring and left its middle (1.2 of 3 deep instead of 3).
// - N_SrfShapeFlatten reads the inside flag of control point [i][j] at [i - il][j - jl], where it
//   computed it; upstream it read [i - su][j - sv], one control point off (il = su - 1) wherever the
//   polygon's box starts inside the knot range, so that the flattened region was shifted by one control
//   point towards the end of each direction.
// The rest is the upstream code, unchanged:
//
//   N_SrfShapeRegionWarp         NL_SrfShape.cpp:5318-5937 (in #if NLIB_UNUSED, lines 1601-5938)
//   N_SrfShapeFlatten            NL_SrfShape.cpp:2639-3041 (in #if NLIB_UNUSED, lines 1601-5938)
//   N_SrfShapeCreateRatBasis     NL_SrfShape.cpp:4992-5139 (in #if NLIB_UNUSED, lines 1601-5938)
//   N_SrfShapeRemoveKnots        NL_SrfShape.cpp:4090-4990 (in #if NLIB_UNUSED, lines 1601-5938)
//   N_BasisSplitNLongestSpans    NL_BasisAdv.cpp:390-531 (in #if NLIB_UNUSED, lines 314-534)
//   N_SrfFuncEvalRatBasis        NL_FuncsAdv.cpp:3996-4103 (in #if NLIB_UNUSED, lines 3939-4376)
//   N_PtsAreInPolygon            NL_FrameBasic.cpp:1010-1142 (in #if NLIB_UNUSED, lines 1008-1705)

#include "StdAfx.h"

#include <nurbs.h>
#include <NL_Globals.h>

#include "nlib_shape.h"

// smlibpy patch: the names (see the notice above)
#define N_SrfShapeRegionWarp smlibpy_N_SrfShapeRegionWarp
#define N_SrfShapeFlatten smlibpy_N_SrfShapeFlatten
#define N_SrfShapeCreateRatBasis smlibpy_N_SrfShapeCreateRatBasis
#define N_SrfShapeRemoveKnots smlibpy_N_SrfShapeRemoveKnots
#define N_BasisSplitNLongestSpans smlibpy_N_BasisSplitNLongestSpans
#define N_SrfFuncEvalRatBasis smlibpy_N_SrfFuncEvalRatBasis
#define N_PtsAreInPolygon smlibpy_N_PtsAreInPolygon

// smlibpy patch: the helpers have internal linkage
static NL_FLAG smlibpy_N_SrfShapeRemoveKnots( NL_SURFACE *sur, NL_REAL tol, NL_INDEX fku, NL_INDEX lku, NL_INDEX fkv, NL_INDEX lkv, NL_STACKS *SG );
static NL_FLAG smlibpy_N_BasisSplitNLongestSpans( NL_KNOTVECTOR *knt, NL_DEGREE p, NL_PARAMETER us, NL_PARAMETER ue, NL_INDEX n, NL_INDEX ks, NL_INDEX ke, NL_KNOTVECTOR *knx );
static NL_FLAG smlibpy_N_SrfFuncEvalRatBasis( NL_SFUN *sfn, NL_INDEX i, NL_INDEX j, NL_PARAMETER u, NL_PARAMETER v, NL_FLAG ufl, NL_FLAG vfl, NL_REAL *R );
static NL_FLAG smlibpy_N_PtsAreInPolygon( NL_EPOLYGON *ppl, NL_POINT ** Q, NL_INDEX r, NL_INDEX s, NL_BOOLEAN ** IN );

// ---- NL_SrfShape.cpp, lines 5318-5937

/**********************************************************************/
/* N_SrfShapeRegionWarp: Surface region warp                          */
/**********************************************************************/

/*******************************************************************//**


   DESCRIPTION:

     This  shaping  routine  warps  a  NURBS  surface  over a  specified 
     polygonal region residing in the parameter  space. The warp is done
     either with a predefined warp function or with a bivariate rational 
     basis  function. To facilitate with  various warps, the warp region 
     does  not have to fall within the knot rectangle. If it is (partly)
     outside the knot  rectangle, the warp is  performed on an imaginary  
     (extended)  surface,  however, only  the real  portion is computed. 
     When  interactive change is required, only those quantities are re-
     computed  that  directly  affect the  change in the warp. A typical 
     calling example is:

       NL_SURFACE    surP, surQ, surW;
       EPOLGON    ppl;
       NL_SFUN       sfnD;
       NL_DEGREE     p, q;
       NL_INDEX      npu, npv, ksu, keu, ksv, kev, siu, eiu, siv, eiv;
       NL_VECTOR     W;
       NL_REAL       *tu, *tv, d, tol, wpq;
       NL_BOOLEAN    **IN;
       NL_STACKS     SP, SQ;
       ...
       (define surP; get ppl, npu,...,kev; get either  surW or W; get
        rational basis function and d, or distance function; get tol);
       ...
       N_SrfShapeCreateRatBasis(wpq,p,q,&sfnD,NL_NEW,&SQ);
       ...
       N_SrfShapeRegionWarp(&surP,&ppl,npu,npv,ksu,keu,ksv,kev,NULL,W,&sfnD,d,tol,
                NL_PREPARE,NL_YES,&tu,&tv,&siu,&eiu,&siv,&eiv,&IN,&surQ,
                &SP,&SQ);
       while( NOT DONE )
       {
           NL_PRIVATE  NL_STRING  rname = "N_SrfShapeRegionWarp");
...
         get new wpq;
         N_SrfShapeCreateRatBasis(wpq,p,q,&sfnD,NL_OLD,&SQ);
         ...
         N_SrfShapeRegionWarp(&surP,&ppl,npu,npv,ksu,keu,ksv,kev,NULL,W,&sfnD,d,
                  tol,NL_INTERACT,NL_NO,&tu,&tv,&siu,&eiu,&siv,&eiv,&IN,&surQ,
                  &SP,&SQ);
         ...
         get new d;
         N_SrfShapeRegionWarp(&surP,&ppl,npu,npv,ksu,keu,ksv,kev,NULL,W,&sfnD,d,
                  tol,NL_INTERACT,NL_NO,&tu,&tv,&siu,&eiu,&siv,&eiv,&IN,&surQ,
                  &SP,&SQ);
         ...
       }
       N_SrfShapeRegionWarp(&surP,&ppl,npu,npv,ksu,keu,ksv,kev,NULL,W,&sfnD,d,tol,
                NL_CLEANUP,NL_NO,&tu,&tv,&siu,&eiu,&siv,&eiv,&IN,&surQ,
                &SP,&SQ);

     THE WARPED  NL_SURFACE IS STORED IN  surQ. ALTHOUGH  THE INPUT NL_SURFACE 
     DOES  NOT  CHANGE  EITHER  GEOMETIRICALLY  OR  PARAMETRICALLY,  ITS 
     DEFINITION IS DESTROYED IN THAT ITS KNOT VECTORS ARE REFINED. IF IT  
     IS   UNACCEPTABLE,  EITHER   SAVE  THE  ORIGINAL NL_SURFACE OR  REMOVE 
     UNNECESSARY KNOTS. IF surP = surQ, NL_NO  INTERACTION IS ALLOWED, I.E.
     ONLY THE "NL_PREPARE" AND "NL_CLEANUP" FLAGS ARE NL_USED. THIS CAPABILITY IS
     USEFUL TO PERFORM A SERIES OF WARPS ON THE  INPUT NL_SURFACE surP. THE 
     NL_SURFACE CAN BE REFINED BEFORE  SHAPING. IN THIS CASE THE REFINEMENT 
     IS SKIPPED IN THE  "NL_PREPARE"  STAGE, HOWEVER, THE ROUTINE CHECKS IF 
     AT LEAST  (p+1)x(q+1)  CONTROL NL_POINTS ARE LOCAL TO THE BOUNDING BOX
     OF ppl.


   ACCESS:
   
     surP    , in/out ,  NURBS surface
     ppl     , input  ,  Closed polygon  residing in the papameter space 
                         of surP. It must at least partially overlap the 
                         knot rectangle.
     npu,npv , input  ,  Number of u/v knots to be inserted. Depends  on 
                         the warp distance; for large warps more control 
                         points are needed to obtain a smooth  change in 
                         shape. The default is 3*p/3*q  for small warps.
     ksu,keu , input  ,  Continuity controls in u-direction; the  warped 
                         surface is at most C^{p-ksu} continuous along a
                         u-line bounding the warp  region from the left,
                         and  C^{p-keu}  continuous  along  an  iso-line 
                         bounding the  region from the right (1<=ksu,keu
                         <=p!). To obtain a u-crease, set ksu=keu=p.
     ksv,kev , input  ,  The same as above applied to the v-direction
     surW    , input  ,  Direction surface:
                            = NULL: use input vector W
                           != NULL: use surW
     W       , input  ,  Warp direction
     sfnD    , input  ,  Warp  distance function  or bivariate  rational 
                         basis function  (must be  parametrized  between 
                         [0,1]!)
     d       , input  ,  Warp distance:
                           > 0.0: sfnD is rational basis function
                           < 0.0: sfnD is distance function
     tol     , input  ,  Knot removal  tolerance. For  shaping accuracy, 
                         1% of the surface's size is a good default
     flg     , input  ,  Flag:
                           NL_PREPARE : get some entities and do first warp
                           NL_INTERACT: change warp by changing d, W, etc
                           NL_CLEANUP : remove unneccesary knots
     ref     , input  ,  Flag:
                           NL_YES: refine surface
                           NL_NO : surface is already refined
     tu,tv   , in/out ,  Local parametrizations
     siu,eiu , in/out ,  U-indexes of local control points
     siv,eiv , in/out ,  V-indexes of local control points
     IN      , in/out ,  Boolean array  indicating which  local  control 
                         point is inside ppl
     surQ    , output ,  Warped surface; if surP=surQ, only the  NL_PREPARE
                         and NL_CLEANUP options are allowed
     SP      , input  ,  surP's stack
     SQ      , input  ,  Stack holding pointers surQ, tu, tv and IN
    


   RETURN CODES:

     0 : No error
     1 : Error saved in NL_ERROR

   ***********************************************************************/

NL_FLAG N_SrfShapeRegionWarp( NL_SURFACE *surP, NL_EPOLYGON *ppl, NL_INDEX npu, NL_INDEX npv, NL_INDEX ksu, NL_INDEX keu, NL_INDEX ksv, NL_INDEX kev, NL_SURFACE *surW, NL_VECTOR W, NL_SFUN *sfnD, NL_REAL d, NL_REAL tol, NL_FLAG flg, NL_FLAG ref, NL_REAL ** tu, NL_REAL ** tv, NL_INDEX *siu, NL_INDEX *eiu, NL_INDEX *siv, NL_INDEX *eiv, NL_BOOLEAN *** IN, NL_SURFACE *surQ, NL_STACKS *SP, NL_STACKS *SQ )
{

    NL_PRIVATE NL_STRING rname = _T("N_SrfShapeRegionWarp");

    NL_FLAG error = NL_NO;

    NL_INDEX i, j, k, l, n, m, r, s, su = 0, eu = 0, sv = 0, ev = 0, nku, nkv, nkx, nky, fku, lku, fkv, lkv;

    NL_DEGREE p, q, pb = 0, qb = 0;

    NL_REAL *U, *V, *tlu = NULL, *tlv = NULL, ul, ur, vl, vr, tsu, teu, tsv, tev, rmax = 0.0, w, f, us, ue, vs, ve, du, dv, x, y;

    NL_POINT ** A, Q, R;

    NL_CPOINT ** Pw, ** Qw = NULL, Tw;

    NL_KNOTVECTOR *knu = NULL, *knv = NULL, *knx, *kny;

    NL_MINMAXBOX box;

    NL_BOOLEAN ** PIP = NULL;

    NL_STACKS SL;

    /* Start NURBS */

    N_InitNurbs( &SL );

    /* Get local notations and check input */

    N_SrfGetCPtsDegreesAndKnots( surP, &n, &m, &Pw, &p, &q, &r, &s, &U, &V );

    switch( flg )
    {
        case NL_PREPARE:

            N_SrfGetKnotVectors( surP, &knu, &knv );
            break;

        case NL_INTERACT:
            if( surP EQ surQ )
                NL_ERROR( NL_INP_ERR );

            su = *siu;
            eu = *eiu;
            tlu = *tu;
            PIP = *IN;
            sv = *siv;
            ev = *eiv;
            tlv = *tv;

            N_SrfGetCPts( surQ, &n, &m, &Qw );
            break;

        case NL_CLEANUP:

            su = *siu;
            eu = *eiu;
            sv = *siv;
            ev = *eiv;
            break;

        default:
            NL_ERROR( NL_CAL_ERR );
    }

    /* Prepare for warp */

    if( flg EQ NL_PREPARE )
    {
        /* Set knot rectangle */

        N_PolygonGetBBox( ppl, &box );
        N_GetBBoxData( &box, &us, &ue, &vs, &ve, &f, &f );

        if( ue LE U[0]OR us GE U[r] )
            NL_ERROR( NL_INP_ERR );

        if( ve LE V[0]OR vs GE V[s] )
            NL_ERROR( NL_INP_ERR );

        if( us LT U[0] )
            ul = U[0];
        else
            ul = us;

        if( ue GT U[r] )
            ur = U[r];
        else
            ur = ue;

        if( vs LT V[0] )
            vl = V[0];
        else
            vl = vs;

        if( ve GT V[s] )
            vr = V[s];
        else
            vr = ve;

        /* Refine surface */

        if( ref EQ NL_YES )
        {
            f = (ur - ul) / (ue - us);
            nku = (NL_INDEX)(f * NL_MAX( npu, 3 * p )) + 1;
            nkx = nku + 2 * p + 1;

            f = (vr - vl) / (ve - vs);
            nkv = (NL_INDEX)(f * NL_MAX( npv, 3 * q )) + 1;
            nky = nkv + 2 * q + 1;

            knx = N_AllocKnotVectorAndArray( nkx, &SL );

            if( knx EQ NULL )
                NL_QUIT;

            kny = N_AllocKnotVectorAndArray( nky, &SL );

            if( kny EQ NULL )
                NL_QUIT;

            error = N_BasisSplitNLongestSpans( knu, p, ul, ur, nku, ksu, keu, knx );

            if( error EQ NL_YES )
                NL_OUT;

            error = N_BasisSplitNLongestSpans( knv, q, vl, vr, nkv, ksv, kev, kny );

            if( error EQ NL_YES )
                NL_OUT;

            error = N_SrfInsertKnots( surP, knx, NL_UDIR, surP, SP, SP );

            if( error EQ NL_YES )
                NL_OUT;

            error = N_SrfInsertKnots( surP, kny, NL_VDIR, surP, SP, SP );

            if( error EQ NL_YES )
                NL_OUT;
        }

        if( surP NEQ surQ )
        {
            N_SrfInitArrays( surQ );
            error = N_SrfCopy( surP, surQ, SQ );

            if( error EQ NL_YES )
                NL_OUT;

            N_SrfGetCPts( surQ, &n, &m, &Qw );
        }
        else
        {
            N_SrfGetCPts( surP, &n, &m, &Qw );
        }

        N_SrfGetCPtsDegreesAndKnots( surP, &n, &m, &Pw, &p, &q, &r, &s, &U, &V );
        N_SrfGetKnotVectors( surP, &knu, &knv );

        /* Get local parametrization */

        error = N_BasisFindSpan( knu, p, ul, NL_LEFT, &su );

        if( error EQ NL_YES )
            NL_OUT;

        error = N_BasisFindSpan( knu, p, ur, NL_LEFT, &eu );

        if( error EQ NL_YES )
            NL_OUT;

        error = N_BasisFindSpan( knv, q, vl, NL_LEFT, &sv );

        if( error EQ NL_YES )
            NL_OUT;

        error = N_BasisFindSpan( knv, q, vr, NL_LEFT, &ev );

        if( error EQ NL_YES )
            NL_OUT;

        if( us EQ U[0] )
            su = 1;

        if( us LT U[0] )
            su = 0;

        if( ue EQ U[r] )
            eu = n + p;

        if( ue GT U[r] )
            eu = n + p + 1;

        if( vs EQ V[0] )
            sv = 1;

        if( vs LT V[0] )
            sv = 0;

        if( ve EQ V[s] )
            ev = m + q;

        if( ve GT V[s] )
            ev = m + q + 1;

        if( ref EQ NL_NO AND eu - p - su - 1 LT p )
            NL_ERROR( NL_INP_ERR );

        if( ref EQ NL_NO AND ev - q - sv - 1 LT q )
            NL_ERROR( NL_INP_ERR );

        k = eu - p - su + 1;
        l = ev - q - sv + 1;

        tlu = N_AllocReal1dArray( k, SQ );

        if( tlu EQ NULL )
            NL_QUIT;

        tlv = N_AllocReal1dArray( l, SQ );

        if( tlv EQ NULL )
            NL_QUIT;

        A = N_AllocPt2dArray( k, l, &SL );

        if( A EQ NULL )
            NL_QUIT;

        for ( i = su; i < eu - p; i++ )
        {
            if( sv EQ 0 )
            {
                N_Combine2CPts( 2.0, Pw[i][0], -1.0, Pw[i][1], &Tw );
                N_CPtToPtEuclid( Tw, &A[i - su + 1][0] );
            }
            else
            {
                N_CPtToPtEuclid( Pw[i][sv - 1], &A[i - su + 1][0] );
            }

            if( ev EQ m + q + 1 )
            {
                N_Combine2CPts( 2.0, Pw[i][m], -1.0, Pw[i][m - 1], &Tw );
                N_CPtToPtEuclid( Tw, &A[i - su + 1][l] );
            }
            else
            {
                N_CPtToPtEuclid( Pw[i][ev - q], &A[i - su + 1][l] );
            }
        }

        for ( j = sv; j < ev - q; j++ )
        {
            if( su EQ 0 )
            {
                N_Combine2CPts( 2.0, Pw[0][j], -1.0, Pw[1][j], &Tw );
                N_CPtToPtEuclid( Tw, &A[0][j - sv + 1] );
            }
            else
            {
                N_CPtToPtEuclid( Pw[su - 1][j], &A[0][j - sv + 1] );
            }

            if( eu EQ n + p + 1 )
            {
                N_Combine2CPts( 2.0, Pw[n][j], -1.0, Pw[n - 1][j], &Tw );
                N_CPtToPtEuclid( Tw, &A[k][j - sv + 1] );
            }
            else
            {
                N_CPtToPtEuclid( Pw[eu - p][j], &A[k][j - sv + 1] );
            }
        }

        for ( i = su; i < eu - p; i++ )
        {
            for ( j = sv; j < ev - q; j++ )
            {
                N_CPtToPtEuclid( Pw[i][j], &A[i - su + 1][j - sv + 1] );
            }
        }

        N_Combine2Pts( 2.0, A[1][0], -1.0, A[2][0], &Q );
        N_Combine2Pts( 2.0, A[0][1], -1.0, A[0][2], &R );
        N_Combine2Pts( 0.5, Q, 0.5, R, &A[0][0] );

        N_Combine2Pts( 2.0, A[1][l], -1.0, A[2][l], &Q );
        N_Combine2Pts( 2.0, A[0][l - 1], -1.0, A[0][l - 2], &R );
        N_Combine2Pts( 0.5, Q, 0.5, R, &A[0][l] );

        N_Combine2Pts( 2.0, A[k - 1][0], -1.0, A[k - 2][0], &Q );
        N_Combine2Pts( 2.0, A[k][1], -1.0, A[k][2], &R );
        N_Combine2Pts( 0.5, Q, 0.5, R, &A[k][0] );

        N_Combine2Pts( 2.0, A[k - 1][l], -1.0, A[k - 2][l], &Q );
        N_Combine2Pts( 2.0, A[k][l - 1], -1.0, A[k][l - 2], &R );
        N_Combine2Pts( 0.5, Q, 0.5, R, &A[k][l] );

        error = N_FitCalcSrfParamValues( (NL_VOID ** )A, k, l, NL_EPOINT, NL_CHORDLENGTH, tlu, tlv );

        if( error EQ NL_YES )
            NL_OUT;

        /* Rescale parameters */

        if( us LT U[0]OR ue GT U[r] )
        {
            if( us LT U[0] )
                tsu = (ul - us) / (ue - us);
            else
                tsu = 0.0;

            if( ue GT U[r] )
                teu = (ur - us) / (ue - us);
            else
                teu = 1.0;

            tlu[0] = tsu;
            tlu[k] = teu;

            for ( i = 1; i < k; i++ )
                tlu[i] = tsu + tlu[i] * (teu - tsu);
        }

        if( vs LT V[0]OR ve GT V[s] )
        {
            if( vs LT V[0] )
                tsv = (vl - vs) / (ve - vs);
            else
                tsv = 0.0;

            if( ve GT V[s] )
                tev = (vr - vs) / (ve - vs);
            else
                tev = 1.0;

            tlv[0] = tsv;
            tlv[l] = tev;

            for ( j = 1; j < l; j++ )
                tlv[j] = tsv + tlv[j] * (tev - tsv);
        }

        /* Compute Boolean array */

        PIP = N_AllocInt2dArray( k - 2, l - 2, SQ );

        if( PIP EQ NULL )
            NL_QUIT;

        du = ue - us;
        dv = ve - vs;

        for ( i = 1; i < k; i++ )
        {
            x = us + tlu[i] * du;

            for ( j = 1; j < l; j++ )
            {
                y = vs + tlv[j] * dv;

                N_PtFromXYZ( x, y, 0.0, &A[i - 1][j - 1] );
            }
        }

        error = N_PtsAreInPolygon( ppl, A, k - 2, l - 2, PIP );

        if( error EQ NL_YES )
            NL_OUT;

        /* Output some parameters for interactive step */

        *siu = su;
        *eiu = eu;
        *tu = tlu;
        *siv = sv;
        *eiv = ev;
        *tv = tlv;
        *IN = PIP;
    }

    /* Interactively warp */

    if( flg EQ NL_INTERACT OR flg EQ NL_PREPARE )
    {
        /* Recover original control points */

        if( surP NEQ surQ )
        {
            for ( i = su; i < eu - p; i++ )
            {
                for ( j = sv; j < ev - q; j++ )
                {
                    N_CopyCPt( Pw[i][j], &Qw[i][j] );
                }
            }
        }

        /* Reposition control points */

        if( d GE 0.0 )
        {
            N_SFuncGetDegrees( sfnD, &pb, &qb );

            error = N_SrfFuncEvalRatBasis( sfnD, pb, qb, 0.5, 0.5, NL_LEFT, NL_LEFT, &rmax );

            if( error EQ NL_YES )
                NL_OUT;
        }

        for ( i = su; i < eu - p; i++ )
        {
            for ( j = sv; j < ev - q; j++ )
            {
                if( PIP[i - su][j - sv] )
                {
                    N_CPtToPtAndW( Qw[i][j], &Q, &w );

                    if( d LT 0.0 )
                    {
                        error = N_SrfFuncEvalPt( sfnD, tlu[i - su + 1], tlv[j - sv + 1], NL_LEFT, NL_LEFT, &f );

                        if( error EQ NL_YES )
                            NL_OUT;
                    }
                    else
                    {
                        error = N_SrfFuncEvalRatBasis( sfnD, pb, qb, tlu[i - su + 1], tlv[j - sv + 1], NL_LEFT, NL_LEFT, &f );

                        if( error EQ NL_YES )
                            NL_OUT;

                        f = (d * f) / rmax;
                    }

                    if( surW NEQ NULL )
                    {
                        error = N_SrfEvalPt( surW, tlu[i - su + 1], tlv[j - sv + 1], NL_LEFT, NL_LEFT, &W );

                        if( error EQ NL_YES )
                            NL_OUT;
                    }

                    N_VectorBlendPt( f, W, &Q );
                    N_Weight( Q, w, &Qw[i][j] );
                }
            }
        }
    }

    /* Remove unnecessary knots */

    if( flg EQ NL_CLEANUP )
    {
        if( su GE p )
            fku = su + (p + 1) / 2;
        else
            fku = p + 1;

        if( eu LE n )
            lku = eu - (p + 2) / 2;
        else
            lku = n;

        if( sv GE q )
            fkv = sv + (q + 1) / 2;
        else
            fkv = q + 1;

        if( ev LE m )
            lkv = ev - (q + 2) / 2;
        else
            lkv = m;

        error = N_SrfShapeRemoveKnots( surQ, tol, fku, lku, fkv, lkv, SQ );

        if( error EQ NL_YES )
            NL_OUT;
    }

    /* End NURBS and Exit */

    EXIT:

    N_EndNurbs( &SL );

    return (error);
}

// ---- NL_SrfShape.cpp, lines 2639-3041

/**********************************************************************/
/* N_SrfShapeFlatten: Flatten a NURBS surface                         */
/**********************************************************************/

/*******************************************************************//**


   DESCRIPTION:

     This shaping routine  flattens a  surface against  a plane.  Either  
     all control points local to a polygonal region are mapped, or  only  
     those  that are  on the same  side of the  plane. A typical calling 
     example is:

       NL_SURFACE  surP, surQ;
       EPOLGON  ppl;
       NL_INDEX    npu, npv, ksu, keu, ksv, kev;
       NL_PLANE    pln;
       NL_VECTOR   W;
       NL_REAL     tol;
       NL_STACKS   SP, SQ;
       ...
       (define surP; get ppl, npu,...,kev; get plane and tol);
       ...
       N_SrfInitArrays(&surQ);
       N_SrfShapeFlatten(&surP,&ppl,npu,npv,ksu,keu,ksv,kev,&pln,W,tol,NL_YES,NL_LEFT,
                NL_YES,&surQ,&SP,&SQ);

     THE  NL_SURFACE  CAN  BE  REFINED  BEFORE  SHAPING. IN  THIS  CASE THE 
     REFINEMENT IS  SKIPPED, HOWEVER, THE  ROUTINE  CHECKS  IF  AT LEAST 
     (p+1)x(q+1) CONTROL NL_POINTS ARE LOCAL TO THE BOUNDING BOX OF ppl. IF
     REFINEMENT IS REQUIRED, IT IS RESTRICTED TO THE BOUNDARIES OF ppl.


   ACCESS:
   
     surP    , in/out ,  NURBS surface
     ppl     , input  ,  Closed polygon  residing in the papameter space 
                         of surP. It must at least partially overlap the 
                         knot rectangle.
     npu,npv , input  ,  Number of u/v knots to be inserted. The default 
                         is 3*p/3*q.
     ksu,keu , input  ,  Continuity   controls   in   u-direction;   the 
                         flattened   surface   is  at   most   C^{p-ksu} 
                           NL_PRIVATE  NL_STRING  rname = "N_SrfShapeFlatten");
continuous along a u-line bounding ppl from the 
                         left, and C^{p-keu} continuous  along  an  iso-
                         line bounding  the  region from the right (1 <= 
                         ksu,keu <= p!). To obtain a u-crease, set ksu = 
                         keu = p.
     ksv,kev , input  ,  The same as above applied to the v-direction
     pln     , input  ,  Plane
     W       , input  ,  Flatten direction
     tol     , input  ,  Knot removal  tolerance. For  shaping accuracy, 
                         1% of the surface's size is a good default
     stf     , input  ,  Side test flag:
                           NL_YES: map points on given side of plane
                           NL_NO : map points local to ppl
     lor     , input  ,  Side indicator:
                           NL_LEFT : map points on the left of plane
                           NL_RIGHT: map points on the right of plane
     ref     , input  ,  Flag:
                           NL_YES: refine surface
                           NL_NO : surface is already refined
     surQ    , output ,  Flattened surface
     SP      , input  ,  surP's stack
     SQ      , input  ,  surQ's stack    


   RETURN CODES:

     0 : No error
     1 : Error saved in NL_ERROR

   ***********************************************************************/

NL_FLAG N_SrfShapeFlatten( NL_SURFACE *surP, NL_EPOLYGON *ppl, NL_INDEX npu, NL_INDEX npv, NL_INDEX ksu, NL_INDEX keu, NL_INDEX ksv, NL_INDEX kev, NL_PLANE *pln, NL_VECTOR W, NL_REAL tol, NL_FLAG stf, NL_FLAG lor, NL_FLAG ref, NL_SURFACE *surQ, NL_STACKS *SP, NL_STACKS *SQ )
{

    NL_PRIVATE NL_STRING rname = _T("N_SrfShapeFlatten");

    NL_FLAG side, its, error = NL_NO;

    NL_INDEX i, j, k, l, n, m, r, s, su, eu, sv, ev, nku, nkv, nkx, nky, fku, lku, fkv, lkv, il, jl, ih, jh;

    NL_DEGREE p, q;

    NL_REAL *U, *V, *tu, *tv, w, t, us, ue, vs, ve, du, dv, x, y;

    NL_POINT ** A, Q;

    NL_CPOINT ** Qw;

    NL_KNOTVECTOR *knu, *knv, *knx, *kny;

    NL_MINMAXBOX box;

    NL_BOOLEAN ** IN = NULL;

    NL_LINESEG lin;

    NL_STACKS SL;

    /* Start NURBS */

    N_InitNurbs( &SL );

    /* Get local notations and check input */

    N_SrfGetCPtsDegreesAndKnots( surP, &n, &m, &Qw, &p, &q, &r, &s, &U, &V );
    N_SrfGetKnotVectors( surP, &knu, &knv );

    if( stf NEQ NL_YES AND stf NEQ NL_NO )
        NL_ERROR( NL_CAL_ERR );

    if( ref NEQ NL_YES AND ref NEQ NL_NO )
        NL_ERROR( NL_CAL_ERR );

    if( lor NEQ NL_LEFT AND lor NEQ NL_RIGHT )
        NL_ERROR( NL_CAL_ERR );

    /* Refine surface */

    N_PolygonGetBBox( ppl, &box );
    N_GetBBoxData( &box, &us, &ue, &vs, &ve, &t, &t );

    if( ue LE U[0]OR us GE U[r] )
        NL_ERROR( NL_INP_ERR );

    if( ve LE V[0]OR vs GE V[s] )
        NL_ERROR( NL_INP_ERR );

    if( us LT U[0] )
        us = U[0];

    if( ue GT U[r] )
        ue = U[r];

    if( vs LT V[0] )
        vs = V[0];

    if( ve GT V[s] )
        ve = V[s];

    if( ref EQ NL_YES )
    {
        nku = NL_MAX( npu, 3 * p ) + 1;
        nkx = nku + 2 * p + 1;

        nkv = NL_MAX( npv, 3 * q ) + 1;
        nky = nkv + 2 * q + 1;

        knx = N_AllocKnotVectorAndArray( nkx, &SL );

        if( knx EQ NULL )
            NL_QUIT;

        kny = N_AllocKnotVectorAndArray( nky, &SL );

        if( kny EQ NULL )
            NL_QUIT;

        error = N_BasisSplitNLongestSpans( knu, p, us, ue, nku, ksu, keu, knx );

        if( error EQ NL_YES )
            NL_OUT;

        error = N_BasisSplitNLongestSpans( knv, q, vs, ve, nkv, ksv, kev, kny );

        if( error EQ NL_YES )
            NL_OUT;

        error = N_SrfInsertKnots( surP, knx, NL_UDIR, surQ, SP, SQ );

        if( error EQ NL_YES )
            NL_OUT;

        error = N_SrfInsertKnots( surQ, kny, NL_VDIR, surQ, SQ, SQ );

        if( error EQ NL_YES )
            NL_OUT;
    }
    else
    {
        error = N_SrfCopy( surP, surQ, SQ );

        if( error EQ NL_YES )
            NL_OUT;
    }

    N_SrfGetCPts( surQ, &n, &m, &Qw );
    N_SrfGetKnotVectors( surQ, &knu, &knv );

    /* Get local parametrization */

    if( stf EQ NL_NO )
    {
        error = N_BasisFindSpan( knu, p, us, NL_LEFT, &su );

        if( error EQ NL_YES )
            NL_OUT;

        error = N_BasisFindSpan( knu, p, ue, NL_LEFT, &eu );

        if( error EQ NL_YES )
            NL_OUT;

        error = N_BasisFindSpan( knv, q, vs, NL_LEFT, &sv );

        if( error EQ NL_YES )
            NL_OUT;

        error = N_BasisFindSpan( knv, q, ve, NL_LEFT, &ev );

        if( error EQ NL_YES )
            NL_OUT;

        if( us EQ U[0] )
        {
            su = 0;
            il = 0;
        }
        else
            il = su - 1;

        if( ue EQ U[r] )
        {
            eu = n + p + 1;
            ih = n;
        }
        else
            ih = eu - p;

        if( vs EQ V[0] )
        {
            sv = 0;
            jl = 0;
        }
        else
            jl = sv - 1;

        if( ve EQ V[s] )
        {
            ev = m + q + 1;
            jh = m;
        }
        else
            jh = ev - q;

        if( ref EQ NL_NO AND eu - p - su - 1 LT p )
            NL_ERROR( NL_INP_ERR );

        if( ref EQ NL_NO AND ev - q - sv - 1 LT q )
            NL_ERROR( NL_INP_ERR );

        k = ih - il;
        l = jh - jl;

        tu = N_AllocReal1dArray( k, &SL );

        if( tu EQ NULL )
            NL_QUIT;

        tv = N_AllocReal1dArray( l, &SL );

        if( tv EQ NULL )
            NL_QUIT;

        A = N_AllocPt2dArray( k, l, &SL );

        if( A EQ NULL )
            NL_QUIT;

        for ( i = il; i <= ih; i++ )
        {
            for ( j = jl; j <= jh; j++ )
            {
                N_CPtToPtEuclid( Qw[i][j], &A[i - il][j - jl] );
            }
        }

        error = N_FitCalcSrfParamValues( (NL_VOID ** )A, k, l, NL_EPOINT, NL_CHORDLENGTH, tu, tv );

        if( error EQ NL_YES )
            NL_OUT;

        IN = N_AllocInt2dArray( k, l, &SL );

        if( IN EQ NULL )
            NL_QUIT;

        du = ue - us;
        dv = ve - vs;

        for ( i = 0; i <= k; i++ )
        {
            x = us + tu[i] * du;

            for ( j = 0; j <= l; j++ )
            {
                y = vs + tv[j] * dv;

                N_PtFromXYZ( x, y, 0.0, &A[i][j] );
            }
        }

        if( us EQ U[0] )
            for ( j = 0; j <= l; j++ )
                N_VectorBlendPt( NL_PTOL, NL_UNITX, &A[0][j] );

        if( ue EQ U[r] )
            for ( j = 0; j <= l; j++ )
                N_VectorBlendPt( -NL_PTOL, NL_UNITX, &A[k][j] );

        if( vs EQ V[0] )
            for ( i = 0; i <= k; i++ )
                N_VectorBlendPt( NL_PTOL, NL_UNITY, &A[i][0] );

        if( ve EQ V[s] )
            for ( i = 0; i <= k; i++ )
                N_VectorBlendPt( -NL_PTOL, NL_UNITY, &A[i][l] );

        error = N_PtsAreInPolygon( ppl, A, k, l, IN );

        if( error EQ NL_YES )
            NL_OUT;
    }
    else
    {
        su = 0;
        eu = n + p + 1;
        sv = 0;
        ev = m + q + 1;
    }

    /* Flatten surface */

    for ( i = su; i < eu - p; i++ )
    {
        for ( j = sv; j < ev - q; j++ )
        {
            N_CPtToPtAndW( Qw[i][j], &Q, &w );

            if( stf EQ NL_YES )
            {
                side = N_PtGetSideOfPlane( pln, Q );

                if( side NEQ lor )
                    continue;
            }
            else
            {
                /* smlibpy patch: IN[0][0] is control point [il][jl], not [su][sv] (was: IN[i - su][j - sv],
                   one control point off where the polygon's box starts inside the knot range, il = su - 1) */
                if( IN[i - il][j - jl]EQ NL_FALSE )
                    continue;
            }

            N_CreateLineStartDirVector( &lin, Q, W, NL_UNBOUNDED );

            error = N_IsectLinePlane( lin, *pln, &Q, &t, &its );

            if( error EQ NL_YES )
                NL_OUT;

            if( its EQ NL_TRUE )
                N_Weight( Q, w, &Qw[i][j] );
        }
    }

    /* Remove unnecessary knots */

    if( su GE p )
        fku = su + (p + 1) / 2;
    else
        fku = p + 1;

    if( eu LE n )
        lku = eu - (p + 2) / 2;
    else
        lku = n;

    if( sv GE q )
        fkv = sv + (q + 1) / 2;
    else
        fkv = q + 1;

    if( ev LE m )
        lkv = ev - (q + 2) / 2;
    else
        lkv = m;

    error = N_SrfShapeRemoveKnots( surQ, tol, fku, lku, fkv, lkv, SQ );

    if( error EQ NL_YES )
        NL_OUT;

    /* End NURBS and Exit */

    EXIT:

    N_EndNurbs( &SL );

    return (error);
}

// ---- NL_SrfShape.cpp, lines 4992-5139

/**********************************************************************/
/* N_SrfShapeCreateRatBasis: Make rational basis function for surface warping         */
/**********************************************************************/

/*******************************************************************//**


   DESCRIPTION:

     This shaping routine creates a rational basis function used to warp
     a surface. It is a  degree  (p,q) rational  basis function  that is 
     defined by symmetrically  placed knots and by unit  weights  except 
     w[p][q] which is used  as a shape  control tool. A  typical calling 
     example is:

       NL_SFUN    sfn;
       NL_REAL    wpq;
       NL_DEGREE  p, q;
       NL_STACKS  S;
       ...
       (get wpq, p and q);
       ...
       N_SrfShapeCreateRatBasis(wpq,p,q,&sfn,NL_NEW,&S);
       while( NOT DONE )
       {
           NL_PRIVATE  NL_STRING  rname = "N_SrfShapeCreateRatBasis");
...
         change wpq;
         N_SrfShapeCreateRatBasis(wpq,p,q,&sfn,NL_OLD,&S);
       }

     If  the NL_NEW  option is  chosen, memory  to store  sfn's  members is 
     allocated. During  interactive design, i.e. with the  NL_OLD flag set, 
     w[p][q] is updated and no other change is made.


   ACCESS:
   
     wpq , input  ,  Weight for w[p][q] (the middle weight; the rest are 
                     set 1.0)
     p,q , input  ,  Degrees of rational basis function
     sfn , in/out ,  Rational  basis function  represented  as a surface
                     function
     flg , input  ,  Flag:
                       NL_NEW: allocate memory  for sfn, compute  knots and
                            weights
                       NL_OLD: update middle weight w[p][q]
     SG  , input  ,  sfn's stack


   RETURN CODES:

     0 : No error
     1 : Error saved in NL_ERROR

   ***********************************************************************/

NL_FLAG N_SrfShapeCreateRatBasis( NL_REAL wpq, NL_DEGREE p, NL_DEGREE q, NL_SFUN *sfn, NL_FLAG flg, NL_STACKS *SG )
{

    NL_PRIVATE NL_STRING rname = _T("N_SrfShapeCreateRatBasis");

    NL_FLAG error = NL_NO;

    NL_INDEX i, j;

    NL_REAL ** w, *U, *V, uinc, vinc;

    NL_STACKS SL;

    /* Start NURBS */

    N_InitNurbs( &SL );

    /* Compute function */

    switch( flg )
    {
        case NL_NEW:

            w = N_AllocReal2dArray( 2 * p, 2 * q, SG );

            if( w EQ NULL )
                NL_QUIT;

            U = N_AllocReal1dArray( 3 * p + 1, SG );

            if( U EQ NULL )
                NL_QUIT;

            V = N_AllocReal1dArray( 3 * q + 1, SG );

            if( V EQ NULL )
                NL_QUIT;

            for ( i = 0; i <= 2 *p; i++ )
            {
                for ( j = 0; j <= 2 *q; j++ )
                    w[i][j] = 1.0;
            }

            w[p][q] = wpq;
            uinc = 1.0 / ((NL_REAL)p + 1.0);
            vinc = 1.0 / ((NL_REAL)q + 1.0);

            for ( i = 0; i <= p; i++ )
            {
                U[2 * p + i + 1] = 1.0;
                U[i] = 0.0;
            }

            for ( i = 1; i <= p; i++ )
                U[p + i] = i * uinc;

            for ( j = 0; j <= q; j++ )
            {
                V[2 * q + j + 1] = 1.0;
                V[j] = 0.0;
            }

            for ( j = 1; j <= q; j++ )
                V[q + j] = j * vinc;

            error = N_SFuncFromKnots( sfn, w, 2 * p, 2 * q, p, q, U, V, 3 * p + 1, 3 * q + 1, SG );

            if( error EQ NL_YES )
                NL_OUT;
            break;

        case NL_OLD:

            N_SFuncGetKnots( sfn, &w, &U, &V );

            w[p][q] = wpq;
            break;

        default:
            NL_ERROR( NL_CAL_ERR );
    }

    /* End NURBS and Exit */

    EXIT:

    N_EndNurbs( &SL );

    return (error);
}

// ---- NL_SrfShape.cpp, lines 4090-4990

/**********************************************************************/
/* N_SRFSHAPEREMOVEKNOTS: Remove all removable knots from a surface being shaped   */
/**********************************************************************/

/*******************************************************************//**


   DESCRIPTION:

     This  tools  routine  removes  all removable  knots  from a NURBS
     surface. The  routine is  for shape operators  where only a given
     range of knots are to be removed. The  removal is  done in place, 
     i.e. the original surface is destroyed. A typical calling example 
     is:

       NL_SURFACE  sur;
       NL_REAL     tol;
       NL_INDEX    fku, lku, fkv, lkv;
       NL_STACKS   SG;
       ...
       (define sur; get tol, fku, lku, fkv and lkv);
       ...
       N_SrfShapeRemoveKnots(&sur,tol,fku,lku,fkv,lkv,&SG);


   ACCESS:
   
     sur     , in/out ,  NURBS surface
     tol     , input  ,  Tolerance to check removability
     fku,lku , input  ,  Indexes of first and last u-knots
     fkv,lkv , input  ,  Indexes of first and last v-knots
     SG      , input  ,  sur's stack


   RETURN CODES:

     0 : No error
     1 : Error saved in NL_ERROR

   ***********************************************************************/

NL_FLAG N_SrfShapeRemoveKnots( NL_SURFACE *sur, NL_REAL tol, NL_INDEX fku, NL_INDEX lku, NL_INDEX fkv, NL_INDEX lkv, NL_STACKS *SG )
{
    NL_PRIVATE NL_STRING rname = _T("N_SrfShapeRemoveKnots");

    NL_FLAG krm, rmf, wfl, rat = NL_NO, error = NL_NO;

    NL_INDEX *sru, *srv, i, j, k, l, row, col, ii, jj, first, last, off, fout, n, m, r, s, ru, su, rv, sv, ns, ms;

    NL_DEGREE p, q;

    NL_REAL ** er, ** te, *U, *V, *alf, *oma, *bet, *omb, *minl, *maxl, *minr, *maxr, *max, *bru, *brv, lam = 0.0, oml = 0.0, wmin, wmax, pmax, tmp, al, be, ob, bu, bv, stu, stv, wi, wj;

    NL_KNOTVECTOR *knu, *knv;

    NL_CPOINT ** Pw, ** Rw;

    NL_STACKS SL;

    NL_PRIVATE NL_REAL sto = 1.0e-05;

    /* Start NURBS */

    N_InitNurbs( &SL );

    /* Get local notation and check indexes */

    N_SrfGetCPtsDegreesAndKnots( sur, &n, &m, &Pw, &p, &q, &r, &s, &U, &V );
    N_SrfGetKnotVectors( sur, &knu, &knv );

    if( fku LE p OR lku GT n )
        NL_ERROR( NL_IND_ERR );

    if( fkv LE q OR lkv GT m )
        NL_ERROR( NL_IND_ERR );

    ns = n;
    ms = m;

    /* Adjust removal tolerance in case of rational surfaces */

    if( N_IsSrfRat( sur ) )
    {
        N_SrfMinMaxWeightPosVectors( sur, &wmin, &tmp, &tmp, &pmax );
        tol = (tol * wmin) / (1.0 + pmax);
        rat = NL_YES;
    }

    stu = sto * fabs( U[r] - U[0] );
    stv = sto * fabs( V[s] - V[0] );

    /* Allocate local memory */

    i = NL_MAX( p, q );
    j = NL_MAX( n, m );

    alf = N_AllocReal1dArray( 2 * i, &SL );

    if( alf EQ NULL )
        NL_QUIT;

    oma = N_AllocReal1dArray( 2 * i, &SL );

    if( oma EQ NULL )
        NL_QUIT;

    bet = N_AllocReal1dArray( 2 * i, &SL );

    if( bet EQ NULL )
        NL_QUIT;

    omb = N_AllocReal1dArray( 2 * i, &SL );

    if( omb EQ NULL )
        NL_QUIT;

    Rw = N_AllocCPt2dArray( j, 2 * i, &SL );

    if( Rw EQ NULL )
        NL_QUIT;

    er = N_AllocReal2dArray( r, s, &SL );

    if( er EQ NULL )
        NL_QUIT;

    te = N_AllocReal2dArray( r, s, &SL );

    if( te EQ NULL )
        NL_QUIT;

    minl = N_AllocReal1dArray( i, &SL );

    if( minl EQ NULL )
        NL_QUIT;

    maxl = N_AllocReal1dArray( i, &SL );

    if( maxl EQ NULL )
        NL_QUIT;

    minr = N_AllocReal1dArray( i, &SL );

    if( minr EQ NULL )
        NL_QUIT;

    maxr = N_AllocReal1dArray( i, &SL );

    if( maxr EQ NULL )
        NL_QUIT;

    max = N_AllocReal1dArray( i + 1, &SL );

    if( max EQ NULL )
        NL_QUIT;

    bru = N_AllocReal1dArray( r, &SL );

    if( bru EQ NULL )
        NL_QUIT;

    sru = N_AllocInt1dArray( r, &SL );

    if( sru EQ NULL )
        NL_QUIT;

    brv = N_AllocReal1dArray( s, &SL );

    if( brv EQ NULL )
        NL_QUIT;

    srv = N_AllocInt1dArray( s, &SL );

    if( srv EQ NULL )
        NL_QUIT;

    /* Initialize */

    for ( i = 0; i <= r; i++ )
    {
        bru[i] = NL_BIGD;
        sru[i] = 0;

        for ( j = 0; j <= s; j++ )
            er[i][j] = 0.0;
    }

    for ( j = 0; j <= s; j++ )
    {
        brv[j] = NL_BIGD;
        srv[j] = 0;
    }

    /* Compute the maximums of knot removal errors for each distinct knot */

    ru = p + 1;

    while( ru LE n )
    {
        i = ru;

        while( ru LE n AND U[ru]EQ U[ru + 1] )
            ru++;

        sru[ru] = ru - i + 1;

        error = N_SrfRemoveOneKnot( sur, ru, sru[ru], 0, m, NL_UDIR, &bru[ru] );

        if( error EQ NL_YES )
            NL_OUT;

        ru++;
    }

    rv = q + 1;

    while( rv LE m )
    {
        i = rv;

        while( rv LE m AND V[rv]EQ V[rv + 1] )
            rv++;

        srv[rv] = rv - i + 1;

        error = N_SrfRemoveOneKnot( sur, rv, srv[rv], 0, n, NL_VDIR, &brv[rv] );

        if( error EQ NL_YES )
            NL_OUT;

        rv++;
    }

    /* Try to remove each knot */

    while( NL_TRUE )
    {
        /* Find knot with smallest error */

        bu = bru[fku];
        su = sru[fku];
        ru = fku;

        for ( i = fku + 1; i <= lku; i++ )
        {
            if( bru[i]LT bu )
            {
                bu = bru[i];
                su = sru[i];
                ru = i;
            }
        }

        bv = brv[fkv];
        sv = srv[fkv];
        rv = fkv;

        for ( j = fkv + 1; j <= lkv; j++ )
        {
            if( brv[j]LT bv )
            {
                bv = brv[j];
                sv = srv[j];
                rv = j;
            }
        }

        /* If no more removable knot -> finished */

        if( bu EQ NL_BIGD AND bv EQ NL_BIGD )
            break;

        if( bu LT bv )
            krm = NL_UDIR;
        else
            krm = NL_VDIR;

        /* Switch to the appropriate direction */

        switch( krm )
        {
            case NL_UDIR: /* Remove in the u-direction */

                /* Compute maximums of basis function */

                rmf = NL_TRUE;

                if( (p + su) % 2 )
                {
                    k = (p + su + 1) / 2;
                    l = ru - k + p + 1;
                    al = (U[ru] - U[ru - k]) / (U[ru - k + p + 1] - U[ru - k]);
                    be = (U[ru] - U[ru - k + 1]) / (U[ru - k + p + 2] - U[ru - k + 1]);
                    ob = 1.0 - be;
                    lam = al / (al + be);
                    oml = 1.0 - lam;

                    error = N_BasisFindAllSpanMaxima( knu, ru - k, p, stu, minl, maxl, &tmp );

                    if( error EQ NL_YES )
                    {
                        for ( i = 0; i <= p; i++ )
                        {
                            minl[i] = 0.0;
                            maxl[i] = 1.0;
                        }
                    }

                    error = N_BasisFindAllSpanMaxima( knu, ru - k + 1, p, stu, minr, maxr, &tmp );

                    if( error EQ NL_YES )
                    {
                        for ( i = 0; i <= p; i++ )
                        {
                            minr[i] = 0.0;
                            maxr[i] = 1.0;
                        }
                    }

                    max[0] = lam * al * maxl[0];

                    for ( i = 1; i <= p; i++ )
                    {
                        minl[i] *= lam * al;
                        minr[i - 1] *= oml * ob;
                        maxl[i] *= lam * al;
                        maxr[i - 1] *= oml * ob;

                        max[i] = NL_MAX( fabs( maxl[i] - minr[i - 1] ), fabs( maxr[i - 1] - minl[i] ) );
                    }
                    max[p + 1] = oml * ob * maxr[p];
                }
                else
                {
                    k = (p + su) / 2;
                    l = ru - k + p;

                    error = N_BasisFindAllSpanMaxima( knu, ru - k, p, stu, minl, max, &tmp );

                    if( error EQ NL_YES )
                    {
                        for ( i = 0; i <= p; i++ )
                            max[i] = 1.0;
                    }
                }

                /* Check the error */

                for ( i = ru - k; i <= l; i++ )
                {
                    if( U[i]NEQ U[i + 1] )
                    {
                        tmp = max[i - ru + k] * bu;

                        for ( j = q; j <= s - q - 1; j++ )
                        {
                            if( V[j]NEQ V[j + 1] )
                            {
                                te[i][j] = er[i][j] + tmp;

                                if( te[i][j]GT tol )
                                {
                                    rmf = NL_FALSE;
                                    break;
                                }
                            }
                        }
                    }

                    if( rmf EQ NL_FALSE )
                        break;
                }

                /* If error test passed -> update error vector and remove knot */

                if( rmf EQ NL_TRUE )
                {
                    for ( i = ru - k; i <= l; i++ )
                    {
                        for ( j = q; j <= s - q - 1; j++ )
                        {
                            if( U[i]NEQ U[i + 1]AND V[j]NEQ V[j + 1] )
                            {
                                er[i][j] = te[i][j];
                            }
                        }
                    }

                    fout = (2 * ru - su - p) / 2;
                    first = ru - p;
                    last = ru - su;
                    off = first - 1;

                    /* Save some parameters */

                    i = first;
                    j = last;

                    while( (j - i)GT 0 )
                    {
                        alf[i - first] = (U[i + p + 1] - U[i]) / (U[ru] - U[i]);
                        oma[i - first] = 1.0 - alf[i - first];
                        bet[j - first] = (U[j + p + 1] - U[j]) / (U[j + p + 1] - U[ru]);
                        omb[j - first] = 1.0 - bet[j - first];
                        i++;
                        j--;
                    }

                    /* Remove the knot for each row */

                    wfl = NL_TRUE;

                    for ( col = 0; col <= m; col++ )
                    {
                        i = first;
                        j = last;
                        ii = 1;
                        jj = last - off;

                        N_CopyCPt( Pw[off][col], &Rw[col][0] );
                        N_CopyCPt( Pw[last + 1][col], &Rw[col][last + 1 - off] );

                        /* Get new control points for one removal step */

                        while( (j - i)GT 0 )
                        {
                            N_Combine2CPts( alf[i - first], Pw[i][col], oma[i - first], Rw[col][ii - 1], &Rw[col][ii] );
                            N_Combine2CPts( bet[j - first], Pw[j][col], omb[j - first], Rw[col][jj + 1], &Rw[col][jj] );
                            i++;
                            j--;
                            ii++;
                            jj--;
                        }

                        /* Check for disallowed weights */

                        if( rat EQ NL_YES )
                        {
                            i = first;
                            j = last;
                            wmin = NL_BIGD;
                            wmax = NL_SMAD;

                            while( (j - i)GT 0 )
                            {
                                N_CPtGetW( Rw[col][i - off], &wi );
                                N_CPtGetW( Rw[col][j - off], &wj );

                                if( wi LT wmin )
                                    wmin = wi;

                                if( wj LT wmin )
                                    wmin = wj;

                                if( wi GT wmax )
                                    wmax = wi;

                                if( wj GT wmax )
                                    wmax = wj;
                                i++;
                                j--;
                            }

                            if( wmin LT NL_WMIN OR wmax GT NL_WMAX )
                            {
                                wfl = NL_FALSE;
                                break;
                            }
                        }

                        if( (p + su) % 2 )
                        {
                            N_Combine2CPts( lam, Rw[col][jj + 1], oml, Rw[col][ii - 1], &Rw[col][ii - 1] );
                        }
                    } /* End for each row */

                    /* See if weights are in the allowable range  */

                    if( wfl EQ NL_FALSE )
                    {
                        bru[ru] = NL_BIGD;
                        continue;
                    }
                    else
                    {
                        /* Save control points */

                        for ( col = 0; col <= m; col++ )
                        {
                            i = first;
                            j = last;

                            while( (j - i)GT 0 )
                            {
                                N_CopyCPt( Rw[col][i - off], &Pw[i][col] );
                                N_CopyCPt( Rw[col][j - off], &Pw[j][col] );
                                i++;
                                j--;
                            }
                        }
                    }

                    /* Successful removal -> shift down some entinties */

                    if( su EQ 1 )
                    {
                        for ( j = q; j <= s - q - 1; j++ )
                        {
                            if( V[j]NEQ V[j + 1] )
                            {
                                er[ru - 1][j] = NL_MAX( er[ru - 1][j], er[ru][j] );
                            }
                        }
                    }

                    if( su GT 1 )
                        sru[ru - 1] = sru[ru] - 1;

                    for ( i = ru + 1; i <= r; i++ )
                    {
                        bru[i - 1] = bru[i];
                        sru[i - 1] = sru[i];
                        U[i - 1] = U[i];

                        for ( j = q; j <= m; j++ )
                            er[i - 1][j] = er[i][j];
                    }

                    for ( col = 0; col <= m; col++ )
                    {
                        for ( i = fout + 1; i <= n; i++ )
                        {
                            N_CopyCPt( Pw[i][col], &Pw[i - 1][col] );
                        }
                    }

                    n--;
                    r--;
                    lku--;
                    N_SrfSetSizeIndices( sur, n, m, p, q, r, s );

                    /* If no more internal knots -> finished */

                    if( (n EQ p OR fku GT lku)AND( m EQ q OR fkv GT lkv ) )
                        break;

                    /* Update error bounds */

                    k = NL_MAX( ru - p, p + 1 );
                    l = NL_MIN( n, ru + p - su );

                    for ( i = k; i <= l; i++ )
                    {
                        if( U[i]NEQ U[i + 1] )
                        {
                            error = N_SrfRemoveOneKnot( sur, i, sru[i], 0, m, NL_UDIR, &bru[i] );

                            if( error EQ NL_YES )
                                NL_OUT;
                        }
                    }

                    for ( j = q + 1; j <= s - q - 1; j++ )
                    {
                        if( V[j]NEQ V[j + 1] )
                        {
                            error = N_SrfRemoveOneKnot( sur, j, srv[j], first, last, NL_VDIR, &brv[j] );

                            if( error EQ NL_YES )
                                NL_OUT;
                        }
                    }
                }
                else
                {
                    /* Knot is not removable */

                    bru[ru] = NL_BIGD;
                }
                break;

            case NL_VDIR: /* Remove in the v-direction */

                /* Compute maximums of basis functions over each span */

                rmf = NL_TRUE;

                if( (q + sv) % 2 )
                {
                    k = (q + sv + 1) / 2;
                    l = rv - k + q + 1;
                    al = (V[rv] - V[rv - k]) / (V[rv - k + q + 1] - V[rv - k]);
                    be = (V[rv] - V[rv - k + 1]) / (V[rv - k + q + 2] - V[rv - k + 1]);
                    ob = 1.0 - be;
                    lam = al / (al + be);
                    oml = 1.0 - lam;

                    error = N_BasisFindAllSpanMaxima( knv, rv - k, q, stv, minl, maxl, &tmp );

                    if( error EQ NL_YES )
                    {
                        for ( j = 0; j <= q; j++ )
                        {
                            minl[j] = 0.0;
                            maxl[j] = 1.0;
                        }
                    }

                    error = N_BasisFindAllSpanMaxima( knv, rv - k + 1, q, stv, minr, maxr, &tmp );

                    if( error EQ NL_YES )
                    {
                        for ( j = 0; j <= q; j++ )
                        {
                            minr[j] = 0.0;
                            maxr[j] = 1.0;
                        }
                    }

                    max[0] = lam * al * maxl[0];

                    for ( j = 1; j <= q; j++ )
                    {
                        minl[j] *= lam * al;
                        minr[j - 1] *= oml * ob;
                        maxl[j] *= lam * al;
                        maxr[j - 1] *= oml * ob;

                        max[j] = NL_MAX( fabs( maxl[j] - minr[j - 1] ), fabs( maxr[j - 1] - minl[j] ) );
                    }
                    max[q + 1] = oml * ob * maxr[q];
                }
                else
                {
                    k = (q + sv) / 2;
                    l = rv - k + q;

                    error = N_BasisFindAllSpanMaxima( knv, rv - k, q, stv, minl, max, &tmp );

                    if( error EQ NL_YES )
                    {
                        for ( j = 0; j <= q; j++ )
                            max[j] = 1.0;
                    }
                }

                /* Check the error */

                for ( j = rv - k; j <= l; j++ )
                {
                    if( V[j]NEQ V[j + 1] )
                    {
                        tmp = max[j - rv + k] * bv;

                        for ( i = p; i <= r - p - 1; i++ )
                        {
                            if( U[i]NEQ U[i + 1] )
                            {
                                te[i][j] = er[i][j] + tmp;

                                if( te[i][j]GT tol )
                                {
                                    rmf = NL_FALSE;
                                    break;
                                }
                            }
                        }
                    }

                    if( rmf EQ NL_FALSE )
                        break;
                }

                /* If error test passed -> update error vector and remove knot */

                if( rmf EQ NL_TRUE )
                {
                    for ( j = rv - k; j <= l; j++ )
                    {
                        for ( i = p; i <= r - p - 1; i++ )
                        {
                            if( V[j]NEQ V[j + 1]AND U[i]NEQ U[i + 1] )
                            {
                                er[i][j] = te[i][j];
                            }
                        }
                    }

                    fout = (2 * rv - sv - q) / 2;
                    first = rv - q;
                    last = rv - sv;
                    off = first - 1;

                    /* Save some parameters */

                    i = first;
                    j = last;

                    while( (j - i)GT 0 )
                    {
                        alf[i - first] = (V[i + q + 1] - V[i]) / (V[rv] - V[i]);
                        oma[i - first] = 1.0 - alf[i - first];
                        bet[j - first] = (V[j + q + 1] - V[j]) / (V[j + q + 1] - V[rv]);
                        omb[j - first] = 1.0 - bet[j - first];
                        i++;
                        j--;
                    }

                    /* Remove knot for each column */

                    wfl = NL_TRUE;

                    for ( row = 0; row <= n; row++ )
                    {
                        i = first;
                        j = last;
                        ii = 1;
                        jj = last - off;

                        N_CopyCPt( Pw[row][off], &Rw[row][0] );
                        N_CopyCPt( Pw[row][last + 1], &Rw[row][last + 1 - off] );

                        /* Get new control points for one removal step */

                        while( (j - i)GT 0 )
                        {
                            N_Combine2CPts( alf[i - first], Pw[row][i], oma[i - first], Rw[row][ii - 1], &Rw[row][ii] );
                            N_Combine2CPts( bet[j - first], Pw[row][j], omb[j - first], Rw[row][jj + 1], &Rw[row][jj] );
                            i++;
                            j--;
                            ii++;
                            jj--;
                        }

                        /* Check for disallowed weights */

                        if( rat EQ NL_YES )
                        {
                            i = first;
                            j = last;
                            wmin = NL_BIGD;
                            wmax = NL_SMAD;

                            while( (j - i)GT 0 )
                            {
                                N_CPtGetW( Rw[row][i - off], &wi );
                                N_CPtGetW( Rw[row][j - off], &wj );

                                if( wi LT wmin )
                                    wmin = wi;

                                if( wj LT wmin )
                                    wmin = wj;

                                if( wi GT wmax )
                                    wmax = wi;

                                if( wj GT wmax )
                                    wmax = wj;
                                i++;
                                j--;
                            }

                            if( wmin LT NL_WMIN OR wmax GT NL_WMAX )
                            {
                                wfl = NL_FALSE;
                                break;
                            }
                        }

                        if( (q + sv) % 2 )
                        {
                            N_Combine2CPts( lam, Rw[row][jj + 1], oml, Rw[row][ii - 1], &Rw[row][ii - 1] );
                        }
                    } /* End for each column */

                    /* See if weights are in the allowable range  */

                    if( wfl EQ NL_FALSE )
                    {
                        brv[rv] = NL_BIGD;
                        continue;
                    }
                    else
                    {
                        /* Save control points */

                        for ( row = 0; row <= n; row++ )
                        {
                            i = first;
                            j = last;

                            while( (j - i)GT 0 )
                            {
                                N_CopyCPt( Rw[row][i - off], &Pw[row][i] );
                                N_CopyCPt( Rw[row][j - off], &Pw[row][j] );
                                i++;
                                j--;
                            }
                        }
                    }

                    /* Successful removal -> shift down some entinties */

                    if( sv EQ 1 )
                    {
                        for ( i = p; i <= r - p - 1; i++ )
                        {
                            if( U[i]NEQ U[i + 1] )
                            {
                                er[i][rv - 1] = NL_MAX( er[i][rv - 1], er[i][rv] );
                            }
                        }
                    }

                    if( sv GT 1 )
                        srv[rv - 1] = srv[rv] - 1;

                    for ( j = rv + 1; j <= s; j++ )
                    {
                        brv[j - 1] = brv[j];
                        srv[j - 1] = srv[j];
                        V[j - 1] = V[j];

                        for ( i = p; i <= n; i++ )
                            er[i][j - 1] = er[i][j];
                    }

                    for ( row = 0; row <= n; row++ )
                    {
                        for ( j = fout + 1; j <= m; j++ )
                        {
                            N_CopyCPt( Pw[row][j], &Pw[row][j - 1] );
                        }
                    }

                    m--;
                    s--;
                    lkv--;
                    N_SrfSetSizeIndices( sur, n, m, p, q, r, s );

                    /* If no more internal knots -> finished */

                    if( (n EQ p OR fku GT lku)AND( m EQ q OR fkv GT lkv ) )
                        break;

                    /* Update error bounds */

                    k = NL_MAX( rv - q, q + 1 );
                    l = NL_MIN( m, rv + q - sv );

                    for ( j = k; j <= l; j++ )
                    {
                        if( V[j]NEQ V[j + 1] )
                        {
                            error = N_SrfRemoveOneKnot( sur, j, srv[j], 0, n, NL_VDIR, &brv[j] );

                            if( error EQ NL_YES )
                                NL_OUT;
                        }
                    }

                    for ( i = p + 1; i <= r - p - 1; i++ )
                    {
                        if( U[i]NEQ U[i + 1] )
                        {
                            error = N_SrfRemoveOneKnot( sur, i, sru[i], first, last, NL_UDIR, &bru[i] );

                            if( error EQ NL_YES )
                                NL_OUT;
                        }
                    }
                }
                else
                {
                    /* Knot is not removable */

                    brv[rv] = NL_BIGD;
                }
                break;
        } /* End of switch */
    }     /* End of while */

    /* Compact surface */

    if( n LT ns OR m LT ms )
    {
        error = N_SrfCompress( sur, SG );

        if( error EQ NL_YES )
            NL_OUT;
    }

    /* End NURBS and Exit */

    EXIT:

    N_EndNurbs( &SL );

    return (error);
}

// ---- NL_BasisAdv.cpp, lines 390-531

/*******************************************************************//**


   DESCRIPTION:

     This routine refines a  knot interval by insering a given number of
     knots into the  interval. Let  [us,ue] be  the given  interval, the 
     routine recursively finds the longest span and inserts the midpoint 
     into [us,ue]. The  continuities at  us and  ue can be controlled. A 
     typical calling example is:

       NL_KNOTVECTOR  knt, knx;
       NL_DEGREE      p;
       NL_INDEX       n, ks, ke;
       NL_PARAMETER   us, ue;
       ...
       (define knt; get memory for knx; get us, ue, n, ks, and ke);
       ...
       N_BasisSplitNLongestSpans(&knt,p,us,ue,n,ks,ke,&knx);

     IT IS ASSUMED THE MEMORY TO STORE  knx  IS ALLOCATED IN THE CALLING
     ROUTINE.


   ACCESS:
   
     knt   , input  ,  Knot vector
     p     , input  ,  Degree 
     us,ue , input  ,  Start and end parameters
     n     , input  ,  Number of knots to be added
     ks,ke , input  ,  Continuity  control; the  curve  must  be at most
                       C^{p-ks} continuous at us and C^{p-ke} at ue. 1<=
                         NL_PRIVATE  NL_STRING  rname = "N_BasisSplitNLongestSpans");
ks,ke<=p!
     knx   , output ,  New knot vector to be merged with knt


   RETURN CODES:

     0 : No error
     1 : Error saved in NL_ERROR

   ***********************************************************************/

NL_FLAG N_BasisSplitNLongestSpans( NL_KNOTVECTOR *knt, NL_DEGREE p, NL_PARAMETER us, NL_PARAMETER ue, NL_INDEX n, NL_INDEX ks, NL_INDEX ke, NL_KNOTVECTOR *knx )
{

    NL_PRIVATE NL_STRING rname = _T("N_BasisSplitNLongestSpans");
    NL_FLAG error = NL_NO;
    NL_INDEX i, j, l=0, is, ie, s, mx, mv, m;
    NL_REAL *U, *V, *X, vmax, vadd;
    NL_STACKS S;

    /* Start NURBS */
    N_InitNurbs( &S );

    /* Check input */
    error = N_KnotVectorIsParamOutOfBounds( knt, us, rname );

    if( error EQ NL_YES )
        NL_OUT;

    error = N_KnotVectorIsParamOutOfBounds( knt, ue, rname );

    if( error EQ NL_YES )
        NL_OUT;

    if( ks LT 1 OR ks GT p )
        NL_ERROR( NL_INP_ERR );

    if( ke LT 1 OR ke GT p )
        NL_ERROR( NL_INP_ERR );

    /* Get local notation */
    N_KnotVectorGetKnots( knt, &m, &U );
    N_KnotVectorGetKnots( knx, &mx, &X );

    mx = -1;

    /* Handle left knot */
    error = N_BasisFindSpanAndMult( knt, p, us, NL_LEFT, &is, &s );

    if( error EQ NL_YES )
        NL_OUT;

    for ( i = 1; i <= ks - s; i++ )
        X[++mx] = us;

    /* Handle right knot */
    error = N_BasisFindSpanAndMult( knt, p, ue, NL_LEFT, &ie, &s );

    if( error EQ NL_YES )
        NL_OUT;

    for ( i = 1; i <= ke - s; i++ )
        X[++mx] = ue;

    /* Add knots */
    V = N_AllocReal1dArray( ie - is + n + 2, &S );

    if( V EQ NULL )
        NL_QUIT;

    mv = 0;
    V[0] = us;

    for ( i = is + 1; i <= ie - s; i++ )
        V[++mv] = U[i];
    V[++mv] = ue;

    for ( i = 1; i <= n; i++ )
    {
        vmax = 0.0;

        for ( j = 0; j < mv; j++ )
        {
            if( V[j + 1] - V[j]GT vmax )
            {
                vmax = V[j + 1] - V[j];
                l = j;
            }
        }

        vadd = 0.5 *(V[l] + V[l + 1]);
        X[++mx] = vadd;

        for ( j = mv; j >= l + 1; j-- )
            V[j + 1] = V[j];
        V[l + 1] = vadd;
        mv++;
    }

    /* Sort array and define knot vector */
    N_ShellSortReal( X, mx );
    N_SetKnotIndex( knx, mx );

    EXIT:

    N_EndNurbs( &S );

    return (error);
} /* end N_BasisSplitNLongestSpans */

// ---- NL_FuncsAdv.cpp, lines 3996-4103

/**********************************************************************/
/* N_SrfFuncEvalRatBasis: Evaluate rat basis function given as a surface function  */
/**********************************************************************/

/*******************************************************************//**


   DESCRIPTION:

     This routine evaluates a rational basis function given as a surface
     function, i.e. the  surface function  represents the denominator of
     the form

                        w_{i,j} N_{i,p} N_{j,q}   
          R_{i,j} = -------------------------------
                    sum_r^s w_{r,s} N_{r,p} N_{s,q}

     A typical calling example is:

       NL_SFUN       sfn;
       NL_INDEX      i, j;
       NL_PARAMETER  u, v;
       NL_REAL       R;
       ...
       (define sfn; get i, j, u and v);
       ...
       N_SrfFuncEvalRatBasis(&sfn,i,j,u,v,NL_LEFT,NL_LEFT,&R);


   ACCESS:
   
     sfn , input  ,  Surface function (the  denomonator of  the rational 
                     form)
     i,j , input  ,  Indexes of rational basis function
     u,v , input  ,  Parameter values 
     ufl , input  ,  Flag:
                       NL_LEFT : u is in [u[k],u[k+1])
                       NL_RIGHT: u is in (u[k],u[k+1]]
     vfl , input  ,  Flag:
                       NL_LEFT : v is in [v[l],v[l+1])
                       NL_RIGHT: v is in (v[l],v[l+1]]
     R   , output ,  Basis function evaluated at (u,v)


   RETURN CODES:

     0 : No error
     1 : Error saved in NL_ERROR

   ***********************************************************************/

NL_FLAG N_SrfFuncEvalRatBasis( NL_SFUN *sfn, NL_INDEX i, NL_INDEX j, NL_PARAMETER u, NL_PARAMETER v, NL_FLAG ufl, NL_FLAG vfl, NL_REAL *R )
{

    NL_FLAG error = NL_NO;

    NL_INDEX k, l;

    NL_DEGREE p, q;

    NL_REAL ** w, *tmp, Ni, Nj, num, den;

    NL_KNOTVECTOR *knu, *knv;

    NL_STACKS S;

    /* Start NURBS */

    N_InitNurbs( &S );

    /* Get local notation */

    N_SFuncGetComponents( sfn, &k, &l, &w, &p, &q, &k, &l, &tmp, &tmp );
    N_SFuncGetKnotVectors( sfn, &knu, &knv );

    /* Get the numerator */

    error = N_BasisIEval( knu, i, p, u, ufl, &Ni );

    if( error EQ NL_YES )
        NL_OUT;

    error = N_BasisIEval( knv, j, q, v, vfl, &Nj );

    if( error EQ NL_YES )
        NL_OUT;

    num = w[i][j] * Ni * Nj;

    /* Get the denominator */

    error = N_SrfFuncEvalPt( sfn, u, v, ufl, vfl, &den );

    if( error EQ NL_YES )
        NL_OUT;

    /* Compute basis function */

    *R = num / den;

    /* End NURBS and Exit */

    EXIT:

    N_EndNurbs( &S );

    return (error);
} /* end N_SrfFuncEvalRatBasis */

// ---- NL_FrameBasic.cpp, lines 1010-1142

/*******************************************************************//**


   DESCRIPTION:

     This geometry routine checks if  points on a grid are inside a 2-D 
     closed polygon. A typical calling example is:

       NL_EPOLYGON  ppl;
       NL_POINT     **Q;
       NL_INDEX     r, s;
       NL_BOOLEAN   **IN;
       ...
       (get ppl and Q; allocate memory for IN);
       ...
       G_ispqpl(&ppl,Q,r,s,IN);

     MEMORY FOR IN MUST BE ALLOCATED IN THE  CALLING ROUTINE TO HOLD UP
     TO IN[r][s]!


   ACCESS:
   
     ppl , input  ,  Closed 2-D polygon
     Q   , input  ,  Point grid in 2-D; Q[i][j] must have 
                       the same x coordinate for i=0,...r, and 
                       the same y coordinate for j=0,...s
     r,s , input  ,  Highest indexes in Q
     IN  , output ,  Boolean array: IN[i][j] =
                       NL_TRUE  if Q[i][j] is in
                       NL_FALSE if Q[i][j] is out 
                    

   RETURN CODES:

     0 : No error
     1 : Error saved in NL_ERROR

   ***********************************************************************/

NL_FLAG N_PtsAreInPolygon( NL_EPOLYGON *ppl, NL_POINT ** Q, NL_INDEX r, NL_INDEX s, NL_BOOLEAN ** IN )
{
    NL_FLAG error = NL_NO;

    NL_INDEX i, j, k, l, n, nip;

    NL_REAL *x, y, xl, xr, yb, yt, dum;

    NL_POINT *P;

    NL_MINMAXBOX box;

    NL_STACKS SL;

    /* Start NURBS */
    N_InitNurbs( &SL );

    /* Get local notation */
    N_EPolygonGetPts( ppl, &n, &P );

    /* Check box overlap */
    N_PolygonGetBBox( ppl, &box );
    N_GetBBoxData( &box, &xl, &xr, &yb, &yt, &dum, &dum );

    if( Q[0][0].y GT yt OR Q[r][s].y LT yb OR Q[0][0].x GT xr OR Q[r][s].x LT xl )
    {
        for ( i = 0; i <= r; i++ )
        {
            for ( j = 0; j <= s; j++ )
                IN[i][j] = NL_FALSE;
        }

        NL_OUT;
    }

    /* For each row shoot one ray and count number of intersections */

    x = N_AllocReal1dArray( n, &SL );

    if( x EQ NULL )
        NL_QUIT;

    for ( j = 0; j <= s; j++ )
    {
        /* See if ray intersects bounding box */

        y = Q[0][j].y;

        if( y GE yb AND y LE yt )
        {
            /* Get all intersections */

            l = -1;

            for ( k = 1; k <= n; k++ )
            {
                /* smlibpy patch: an edge crosses the ray where one end lies above it and the other does not
                   (was: one end above y and the other below y + NL_MTOL, which counts both edges at a vertex
                   less than NL_MTOL above the ray: a row of control points through two vertices of the
                   polygon was taken for outside it) */
                if( (P[k].y GT y) NEQ (P[k - 1].y GT y) )
                {
                    x[++l] = P[k].x + ((y - P[k].y) * (P[k].x - P[k - 1].x)) / (P[k].y - P[k - 1].y);
                }
            }

            /* Check each point on the same row */

            for ( i = 0; i <= r; i++ )
            {
                nip = 0;

                for ( k = 0; k <= l; k++ )
                    if( x[k]GT Q[i][j].x )
                        nip++;

                if( nip % 2 )
                    IN[i][j] = NL_TRUE;
                else
                    IN[i][j] = NL_FALSE;
            }
        }
        else
        {
            for ( i = 0; i <= r; i++ )
                IN[i][j] = NL_FALSE;
        }
    }

    /* End NURBS and Exit */

    EXIT:

    N_EndNurbs( &SL );

    return (error);
} /* end N_PtsAreInPolygon */
