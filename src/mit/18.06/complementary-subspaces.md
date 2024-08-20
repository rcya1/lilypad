---
title: Complementary Subspaces
date: 2024-08-20
order: 7
---

||definition Complementary Subspaces
Subspaces $U, V \in \reals^n$ are complementary if $U \cap V = \{0\}$ and $U + V = \reals^n$

- $U + V = \reals^n$ if any $x \in \reals^n$ can be written as $u + v$

||

||proposition Unique Decomposition
Suppose $U, V \in \reals^n$ are complementary. Then any $x \in \reals^n$ has a unique decomposition $x = u + v$.
||

**Proof**:

- Suppose we had another decomposition $x = u' + v'$
- Then $u - u' = v - v'$ but $u - u' \in U$ and $v - v' = V$
  - The only thing in the intersection of $U$ and $V$ is $0$, so the decompositions are the same

||proposition
The vectors $u, v$ that are the decomposition of $x$ are the projections of $x$ on $U$ and $V$ respectively
||

**Proof Strategy**

- Show that $v$ and $w$ are the closest points to $x$ in $V$ and $W$

||theorem Fundamental Theorem of Linear Algebra
$N(A)$ and $C(A^t)$ are orthogonal complements
||
