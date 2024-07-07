---
title: Four Subspaces
date: 2024-07-06
order: 6
---

- **Row space** is span of all rows of $A$
  - Equivalently, $C(A^T)$
- **Left nullspace** is set of all vectors $v$ such that $v^TA = 0$

  - Equivalently, $A^Tv = 0$, or $N(A^T)$

We could calculate these by computing RREF of $A^T$

- There is a way to calculate this all from a single RREF of $A$ but will omit here

### Relationships

- Both $C(A)$ and $N(A^T)$ live in $\reals^m$
  - Their dimensions add up to $m$ and the subspaces are orthogonal to one another
  - That is, all vectors in $C(A)$ are orthogonal to those in $N(A^T)$
- Both $C(A^T)$ and $N(A)$ live in $\reals^n$
  - Dimensions also add to $n$ and these are orthogonal
