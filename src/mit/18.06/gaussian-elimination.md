---
title: Gaussian Elimination
date: 2024-07-06
order: 1
---

## Gaussian Elimination

$$
\begin{align*}
x_1& & &- x_2& & +& 2x_3& &= 1 \\
-2x_1& & &+ 2x_2& & -& 3x_3& &= -1 \\
-4x_1& & &- x_2& & +& 2x_3& &= -3
\end{align*}
\\
\updownarrow
\\
\begin{pmatrix*}[r]
1 & -1 & 2 \\
-2 & 2 & -3 \\
-3 & -1 & 2
\end{pmatrix*}
\begin{pmatrix}
x_1 \\ x_2 \\ x_3
\end{pmatrix} =
\begin{pmatrix*}[r]
1 \\ -1 \\ -3
\end{pmatrix*}\\
\updownarrow\\
\begin{pmatrix*}[r]
\boxed{1} & -1 & 2 & | & 1 \\
\boxed{-2} & 2 & -3 & | & -1 \\
\boxed{-3} & -1 & 2 & | & -3
\end{pmatrix*}
$$

- Find the first nonzero entry in each row (**pivot of the row**)
  - These are boxed
- Start with the pivot in the 1st row (assuming there is no pivot to the left of it)
- Eliminate nonzero entries below it
- Do this by adding or subtracting multiples of other equations to cancel out entries in other rows

$$
\begin{pmatrix}E_1 \\ E_2 \\ E_3\end{pmatrix} = \begin{pmatrix*}[r]
1 & -1 & 2 & | & 1 \\
-2 & 2 & -3 & | & -1 \\
-3 & -1 & 2 & | & -3
\end{pmatrix*}
$$

$$
\begin{align*}
(E1')&=(E1) \\
(E2')&=(E2) - (-2)(E1) \\
(E3')&=(E3) - (-3)(E1) \\
\end{align*}
\rightarrow
\begin{pmatrix*}[r]
\boxed{1} & -1 & 2 & | & 1 \\
0 & 0 & \boxed{1} & | & 1 \\
0 & \boxed{-4} & 8 & | & 0
\end{pmatrix*} = (A'|b')
$$

$$
\begin{align*}
(E1'')&=(E1') \\
(E2'')&=(E3') \\
(E3'')&=(E2') \\
\end{align*}
\rightarrow

\begin{pmatrix*}[r]
\boxed{1} & -1 & 2 & | & 1 \\
0 & \boxed{-4} & 8 & | & 0 \\
0 & 0 & \boxed{1} & | & 1
\end{pmatrix*}=(\tilde{A}|\tilde{b})
$$

This system is in **row echelon form**

- Can now be easily solved through back substitution

### Using Matrices to Represent

$$
\begin{pmatrix}
1 & 0 & 0 \\ 2& 1 & 0 \\3 & 0 & 1
\end{pmatrix}\begin{pmatrix*}[r]
1 & -1 & 2 \\
-2 & 2 & -3 \\
-3 & -1 & 2
\end{pmatrix*}
\begin{pmatrix}
x_1 \\ x_2 \\ x_3
\end{pmatrix} =
\begin{pmatrix}
1 & 0 & 0 \\ 2& 1 & 0 \\3 & 0 & 1
\end{pmatrix}
\begin{pmatrix*}[r]
1 \\ -1 \\ -3
\end{pmatrix*}
$$

$$
\begin{pmatrix}
1 & 0 & 0 \\ 0& 0 & 1 \\0 & 1 & 0
\end{pmatrix}\begin{pmatrix*}[r]
1 & -1 & 2 \\
0 & 0 & 1 \\
0 & -4 & 8
\end{pmatrix*}
\begin{pmatrix}
x_1 \\ x_2 \\ x_3
\end{pmatrix} =
\begin{pmatrix}
1 & 0 & 0 \\ 0& 0 & 1 \\0 & 1 & 0
\end{pmatrix}
\begin{pmatrix*}[r]
1 \\ 1 \\ 0
\end{pmatrix*}
$$

### Gauss-Jordan Elimination

Continuation where we make each pivot equal to $1$ and then eliminate non-pivot rows

$$
\begin{pmatrix*}[r]
\boxed{1} & -1 & 2 & | & 1 \\
0 & \boxed{1} & -2 & | & 0 \\
0 & 0 & \boxed{1} & | & 1
\end{pmatrix*}
\\
\begin{align*}
(E1')&=(E1)-2(E3) \\
(E2')&=(E2)+2(E3) \\
(E3')&=(E3) \\
\end{align*}
\rightarrow

\begin{pmatrix*}[r]
1 & -1 & 0 & | & -1 \\
0 & 1 & 0 & | & 2 \\
0 & 0 & 1 & | & 1
\end{pmatrix*}
\\
\begin{align*}
(E1'')&=(E1')+(E2) \\
(E2'')&=(E2') \\
(E3'')&=(E3') \\
\end{align*}
\rightarrow

\begin{pmatrix*}[r]
1 & 0 & 0 & | & 1 \\
0 & 1 & 0 & | & 2 \\
0 & 0 & 1 & | & 1
\end{pmatrix*}
$$

Results in **reduced row echelon form** which is unique for each matrix
