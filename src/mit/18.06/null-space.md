---
title: Null Space
date: 2024-07-06
order: 5
---

## Null Space

||definition Null Space
The **null space** of a $m \times n$ matrix $A$ is the space $N(A)$ of all vectors $x$ such that
$$Ax = 0$$
||

||proposition
Invertible row operations do not change the null space of a matrix $A$

**Proof**:

- For $GA$ where $G$ is invertible, we have $GAx = 0$ implies $Ax = G^{-1}0 = 0$
- Additionally $Ax = 0$ implies $GAx = 0$, so bijection
  ||

### Computing Null Space of RREF Matrix

$$
R = \begin{pmatrix}
\boxed{1} & 3 & 0 & 7 \\
0 & 0 & \boxed{1} & 2
\end{pmatrix}
$$

- Pivot variables are those boxed
- Each other column represents a "free" variable
  - Selecting values for the free variables determines the pivot variables
  - Dimension of null space = number of free variables

Setting this to zero:

$$
x_1 + 3x_2 + 7x_4 = 0 \\
x_3 + 2x_4 = 0 \\
\downarrow \\
\begin{align*}
x_1 &= -3x_2 - 7x_4 \\
x_3 &= -2x_4\end{align*}
$$

$$
N(R) = \left\{\begin{pmatrix*}-3x_2 - 7x_4 \\
x_2 \\
-2x_4 \\
x_4
\end{pmatrix*} : x_2, x_4 \in \R\right\} = \left\{x_2\begin{pmatrix*}[r]
-3 \\
1 \\
0 \\
0
\end{pmatrix*}+x_4\begin{pmatrix*}[r]
-7 \\
0 \\
-2 \\
1
\end{pmatrix*}\right\} = \\
\text{span}\left\{\begin{pmatrix*}[r]
-3 \\
1 \\
0 \\
0
\end{pmatrix*}, \begin{pmatrix*}[r]
-7 \\
0 \\
-2 \\
1
\end{pmatrix*}\right\} \Rightarrow \text{2 dimensional subspace of $\R^4$}
$$

### General Method

- Find reduced row echelon form $R$
- Null space is span of $v_1, v_2, \dots, v_l$
  - $l = n - \text{\# of pivot variables}$
  - Find $v_i$ by:
    - Set $i$th free variable coefficient to $1$
    - Set all other free variables to $0$
    - Let pivot variables be determined by the respective equations (since thier values are governed by free variables)
