---
title: lu-factorization
date: 2024-07-06
order: 2
---

## LU Factorization

Writing the matrices that bring a matric $A$ to REF as $G_1$, $G_2$, $\cdots$, $G_i$, we can write:

- $L = (G_i\cdots G_2G_1)^{-1}$
- $U = G_i \cdots G_2G_1A$

$U$ is the REF of $A$ and $L$ is lower triangular iff there are **no** row swaps / permutations done in any of the $G_i$.

### Solving Systems of Linear Equations

Useful when $A$ is invertible and you need to solve $Ax = b$ because substition allows you to easily solve equations for triangular matrices

- Solve $Lc = b$ for $c$
- Then solve $Ux = c$

### LDU Factorization

$L$ will always have 1s for pivots but $U$ may not

- Can solve for this by introducing a diagonal matrix $D$ that normalizes $U$
