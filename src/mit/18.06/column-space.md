---
title: Column Space
date: 2024-07-06
order: 4
---

## Column Space

||definition Column Space
The **column space** of a $m \times n$ matrix $A$ is the space $C(A)$ of all vectors $b$ such that there is some $x$ such that $Ax = b$.
||

Column space is the span of the columns of $A$

- To express the column space succintly, we want to find the basis of the column space

### Finding Basis

A set of vectors is linearly independent if there is no set of coefficients such that the linear combination of the vectors is $0$

- Therefore, the null space of the matrix with these vectors is just $\{0\}$
- If we bring the matrix to RREF, then the pivot columns are linearly independent
  - The free columns are just linear combinations of the pivot columns, so these pivot columns still clearly span the same vector space as the RREF matrix
- If the pivot columns were $r_{i_1}, r_{i_2}, \dots$, we claim that $v_{i_1}, v_{i_2}, \dots$ in the original matrix are also linearly independent
  - Due to fact that going to RREF is always an invertible matrix operation

### Guide for Finding Basis

- Create matrix with vectors forming the columns
- Bring matrix to RREF
- Find indices of columns that form pivots in RREF
- Those columns in the original matrix form a linearly independent basis
