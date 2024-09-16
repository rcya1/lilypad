---
title: Multivariate Distributions
date: 2024-09-12
order: 2
---

||definition Outer Product
The outer product of two vectors $x$ and $y$ is $xy^T$:

$$
xy^T = \begin{pmatrix*}
x_1y_1 & x_1y_2 & \dots & x_1y_m \\
x_2y_1 & x_2y_2 & \dots & x_2y_m \\
\vdots & \vdots & \ddots & \vdots \\
x_ny_1 & x_ny_2 & \dots & x_ny_m
\end{pmatrix*}
$$

The outer product of a vector with itself $xx^T$ is the multi-dimensional generalization of the square of a number
||

## Random Vectors

||definition Covariance Matrix
The covariance $\Sigma$ of a random vector $X$ is defined as:
$$\Sigma = \var{X} = \exp{(X - \mu)(X - \mu)^T} = \exp{XX^T} - \mu\mu^T$$

The $ij$ th entry of $\Sigma$ is $\cov{X_i, X_j}$
||

- The inverse of the covariance matrix is sometimes called the **precision** matrix

||theorem Linear Transformations

Let $a \in \reals^k$ be a deterministic vector. Then $a^TX \in \reals$ with:

- $\exp{a^TX} = a^T\mu$
- $\var{a^TX} = a^T \Sigma a$

Let $A \in \reals^{k \times l}$ be a deterministic matrix and $b \in \reals^\ell$ be a deterministic vector. Then $A^TX + b \in \reals^\ell$ with:

- $\exp{A^TX + b} = A^T\mu + b$
- $\var{A^TX + b} = A^T \Sigma A$
  ||

**Proof of First Statement**:

- Expectations is relatively straightforward via linearity
- For computing the variance, we make use of the fact that for some real number $x$, $x = x^T$
- We first compute the expectation $\exp{(a^TX)^2}$:
  - $\exp{(a^TX)^2} = \exp{a^TXX^Ta} = a^T \exp{XX^T}a$
- Then we have:
  - $\paren{\exp{a^TX}}^2 = a^T\mu\mu^T a$
- Subtracting these and factoring gives us $a^T\Sigma a$

## Multivariate Distributions

||definition Probability Density Function
The PDF of a random vector $X$ is a function $f: \reals^k \rightarrow \reals$ such that $f(x) \geq 0$ and $\int_{\reals^k} f(x)dx = 1$
||

We also call this the **join** density of each of the individual variables in $X$ (i.e. $f$ is the joint density of $X_1, \dots, X_k$)

||definition Marginal Density
The marginal density of $X_j$ is obtained by integrating with respect to all variables except the $j$th one:
$$f_j(x_j) = \int \int \dots \int f(x_1, \dots, x_k)dx_1 \dots dx_{j-1} dx_{j + 1} \dots dx_k$$
||

Specifying joint PDFs can be complicated since it has to account for all possible dependencies between variables. Covariances capture pairwise, but there could be triples / quadruples.

### Independent Random Variables

If $X_1, \dots, X_k$ are independent, then the joint density takes the following product form:
$$f(x_1, \dots, x_k) = \prod_{i=1}^k f_i(x_i)$$

### Conditional Distribution

||definition Conditional PDF
The conditional density of $X_k$ given the values for all other indices is:
$$f(x_k | X_1 = x_1, \dots, X_{k-1} = x_{k-1}) = \frac{f(x_1, \dots, x_k)}{\int_{\reals^k} f(x_1, \dots, x_k)dx_k}$$
||

## Multivariate Gaussian

The 1D Gaussian PDF is given as:

$$p(x) = \mathcal{N}(x; \mu, \sigma^2) = \frac{1}{\sigma \sqrt{2\pi}} \cdot \text{exp}\paren{-\frac{1}{2}\paren{\frac{x-\mu}{\sigma}}^2}$$

For a $k$ -dimensional Gaussian, we have:

$$f(x) = \frac{1}{\sqrt{(2\pi)^k \det \Sigma}} \text{exp}\paren{-\frac{1}{2} (x-\mu)^T \Sigma^{-1} (x - \mu)}$$

To standardize a $k$ -dimensional Gaussian:

$$Z = \Sigma^{-1/2} (X - \mu) \sim \mathcal{N}_k(0, I_k)$$

||theorem Multivariate CLT
For iid random vectors $X_1, \dots, X_n$ in $\reals^k$ with mean $\mu$ and covariance $\Sigma$, we have:
$$\sqrt{n}\paren{\frac{\sum X_i}{n} - \mu} \rightsquigarrow \mathcal{N} \paren{0, \Sigma}$$
||

||theorem Multivariate Delta Method
With the same setup but with $g: \reals^k \rightarrow \reals$ such that $\nabla g(\mu) \neq 0$, then:
$$\sqrt{n}\paren{g\paren{\frac{\sum X_i}{n}} - g(\mu)} \rightsquigarrow \mathcal{N}\paren{0, \nabla g(\mu)^T \Sigma \nabla g(\mu)}$$
||

### Multivarate Delta Example

Suppose $g(x) = x_1x_2\dots x_k$. Suppose $X_i$ are iid with $\mu = (2, \dots, 2)^T$ and covariance $I_k$. To get the limiting distribution of $g(\overline{X_n})$, we use the Delta method

- $g(\mu) = 2^k$
- $\nabla g(x) = \begin{pmatrix*}x_2x_3\dots x_k \\ x_1x_3\dots x_k \\ \vdots \\ x_1x_2 \dots x_{k-1}\end{pmatrix*}$
- $\nabla g(\mu) = 2^{k-1} \cdot {1}_k$

Putting these together, the resulting variance will be $2^{2k-2} \cdot k$
