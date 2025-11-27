---
title: Matrix Multiplication
date: 2024-07-06
order: 3
---

## Block Multiplication

When multiplying $A$ and $B$, can break them up into blocks

hi

$$
A = \begin{pmatrix}A_{1,1} & \dots & A_{1,n} \\
\vdots \\
A_{m,1} & \dots & A_{m,n}\end{pmatrix}, B = \begin{pmatrix}B_{1,1} & \dots & B_{1,p} \\
\vdots \\
B_{n,1} & \dots & B_{n,p}\end{pmatrix}
$$

Blocks don't have to be the same sizes, but they do have to be able to multiply with each other properly

$$
AB=C=\begin{pmatrix}C_{1,1} & \dots & C_{1,p} \\
\vdots \\
C_{m,1} & \dots & C_{m,p}\end{pmatrix}\\C_{ik}=\sum_{j=1}^n{A_{ij}B_{jk}}
$$

## Column Oriented Multiplication

In $AB = C$, each of the columns of $C$ are a linear combination of the columns of $A$

- Each column in $B$ tells you the coefficients in that linear combination
- Number of columns of $A$ = number of rows of $B$

## Row Oriented Multiplication

In $AB = C$, each of the columns of $C$ are a linear combination of the rows of $B$

- Each row in $A$ tells you the coefficients in that linear combination
- Number of columns of $A$ = number of rows of $B$

## Multiplying Diagonal Matrices

For a diagonal matrix $D$ and matrix $A$:

- $DA$ multiplies the $i$ th row in $A$ by the $i$ th element of $D$
- $AD$ multiplies the $i$ th column in $A$ by the $i$ th element of $D$
