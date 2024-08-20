---
title: Projection Matrices
date: 2024-08-20
order: 8
---

$\text{proj}_V(x)$ is the unique vector $v$ such that:

- It is the closest in $V$ to $x$
- $x - v \perp V$

## Projection Onto Vector

Suppose $Y = \text{span}\set{y}$ where $y \in \reals^n \backslash \set{0}$

- To have $v$ be the projection of $x$ onto this, we have $v = cy$ and:
  $$0 = y\cdot(x-v) = y\cdot(x-cy) = x\cdot y - c||y||^2$$
- Then: $v = cy = \paren{\frac{x\cdot y}{\mag{y}^2}}y$

This can alternatively be written as the projection matrix $P_Y$:
$$P_Y = \frac{1}{\mag{y}^2} yy^t$$

## Projection onto Matrix

Doing the same thing for projecting $b$ onto the column space of a matrix $A$ gives us:

- Our projection is $v = Ax$ for some $x$
- Being perpendicular to $V = C(A)$ means that it is in $N(A^t)$
  - $A^t(b - v) = 0 \implies x = (A^tA)^{-1}A^tb$
  - $v = Ax = A(A^tA)^{-1}A^tb$

Our projection matrix $P_A$ is then:
$$P_A = A(A^tA)^{-1}A^t b$$

- Only holds if $A^tA$ is invertible
  - If $A$ has linearly independent columns (i.e. its columns are a basis for $V$), then $A^tA$ will be invertible
