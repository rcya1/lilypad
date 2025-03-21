---
title: Exponential Families
date: 2025-03-11
order: 7
---

## Exponential Families

An exponential family is a parameterized family of distributions

||definition Single-Parameter Exponential Family
For some $X \subset \reals$, a parameterized family of distributions over the alphabet $Y$ is a **single parameter exponential family** if it can be expressed in the form:
$$p_y(y; x) = \t{exp}\p{\lambda(x)t(y) - \alpha(x) + \beta{y}}$$
for some choice of functions $\lambda, t, \beta$
||

- $\lambda$: natural parameter
- $t$: natural statistic
- $\beta$: log base function

$\alpha$ is not part of the specification because it is for normalization

- A family may become no longer possible to be normalized for specific $x$

$$Z(x) = e^{\alpha(x)} = \sum_y \t{exp}\p{\lambda(x) t(y) + \beta(y)}$$

- $Z(x)$ is known as the partition function
- $\alpha(x)$ is then known as the log-partition function

We denote that $y$ follows an exponential family by:
$$y \sim p \in \mc{E}(\mc{X}, \mc{Y}, \lambda, t, \beta)$$

We note that if we instead factor out $\beta(y)$ to get:
$$p_y(y; x) \propto q(y) \t{exp}\p{\lambda(x)t(y)}$$

- If we can get $q(y)$ to be a distribution (integrate to $1$) then this is known as the **base distribution** of the family

||definition Canonical Single-Parameter Exponential Family
A **canonical exponential family** is one with $\lambda(x) = x$
||

||definition Natural Parameter Set
The **natural parameter space** is the collection of all possible $x$ such that the corresponding form of the distribution can be normalized
||

- This is a convex set, which we will see shortly
- When $\mc{Y}$ is finite, it is an open set

||definition Natural Exponential Families
Canonical exponential families with $\mc{Y} \subset \reals$ and $t(y) = y$ are referred to as natural exponential families
||

### Log-Partition Function Properties

||theorem Property 1
The log-partition function for a general exponential family satisfies:
$$\deriv{}{x} \alpha(x) = \deriv{}{x} \lambda(x) \cdot \exp{t(y)}$$
||

||theorem Property 2
The log-partition function for a general exponential family satisfies:
$$\frac{d^2}{dx^2} \alpha(x) = \p{\deriv{}{x} \lambda(x)}^2 \cdot \frac{d^2}{dx^2} \lambda(x) \cdot \var{t(y)}$$
||

If we have a canonical exponential family, this simplies to just $\var{t(y)}$

- This implies the log-partition function is convex since the variance is nonnegative
- This then verifies that the natural parameter space is convex for canonical exponential families

||theorem Property 3
The score function for a general exponential family satisfies:
$$S(y; x) = \pfrac{}{x} \ln p_y(y; x) = \deriv{}{x} \lambda(x) \cdot \p{t(y) - \exp{t(y)}}$$
||

||theorem Property 4
The Fisher information for a general exponential family satisfies:
$$J_y(x) = \exp{S(y; x)^2} = \p{\deriv{}{x} \lambda(x)}^2 \cdot \var{t(y)}$$
||

||theorem Property 5
For a general exponential family, we have:
$$\deriv{}{x} \exp{t(y)} = \deriv{}{x} \lambda(x) \cdot \var{t(y)}$$
||

This allows Property 4 to equivalently be expressed as:
$$J_y(x) = \deriv{}{x} \lambda(x) \cdot \deriv{}{x} \exp{t(y)}$$

### Exponential Family Constructions and Interpretations

Many familiar parameterized distributions can be expressed as exponential families:

- Bernoulli random variable
- Binomial random variable
- Guassian random variable
- Exponential random variable

The uniform random variable is **not** exponential

#### Geometric Mean of Distributions

||Weighted Geometric Mean
COnsider two strictly positive probability distributions $p_1$ and $p_2$, the \*\*weighted geometric mean of these distributions is defined for all $x \in [0, 1]$:
$$p_y(y; x) = \frac{p_1(y)^x p_2(y)^{1-x}}{Z(x)}$$
||

This is an exponential family with:

- $\lambda(x) = x$
- $t(y) = \ln p_1(y) / p_2(y)
- $\beta(y) = \ln p_2(y)$
- $\alpha(x) = \ln Z(x)$

**Any** canonical exponential family over a finite alphabet $\mc{Y}$ can be expressed as the geometric mean of two distributions

- To see this, suppose we have a family specified by $t$ and $\beta$
- Then choose $p_2(y) = c_1e^{\beta(y)}$ and $p_1(y) = c_2p_2(y)e^{t(y)}$
- This implies that given two distributions $p_1$ and $p_2$:
  - There is a single-parameter canonical exponential family that includes both as members
    - This is because we could weight the geometric mean to just get one or the other
  - That single-parameter canonical exponential family is unique
  - This is summarized in the following theorem

||theorem Geometric Mean Characterization of Canonical Exponential Families
Let $\mc{P}$ denote a single-dimensional family of distributions over $\mc{Y}$ for all $x \in \mc{X}$, where $\mc{X}$ is convex. Then $\mc{P}$ is a canonical exponential family iff for every $p_1, p_2, p_3 \in \mc{P}$ there is some $\lambda \in \reals$ such that:
$$p_3(y) = \frac{p_1(y)^\lambda p_2(y)^{1-\lambda}}{Z(\lambda)}$$
||

#### Tilting Distributions

Given a base distribution $q$ over an alphabet $\mc{Y} \subset \reals$ we refer to $p_y(\cdot; x)$ as a tilted distribution where:
$$p_y(y; x) = \frac{q(y)e^{xt(y)}}{Z(x)}$$

It is a member of an exponential family with:

- $\lambda(x) = x$
- $t(y) = t(y)$
- $\beta(y) = \ln q(y)$
- $\alpha(x) = \ln Z(x)$

Any canonical exponential family with a finite alphabet $\mc{Y}$ can be expressed as a tilted distribution

### Efficient Estimators

||theorem Exponential Fmaily Characterization of Efficient Estimators
An efficient estimator exists for estimating a nonrandom parameter $x$ from observations $y$ iff the model $p_y(y; x)$ is a member of an exponential family such that:
$$\deriv{}{x} \lambda(x) = cJ_y(x)$$
for some constant $c > 0$.

When it exist, the efficient estimator takes the form for some constant $b$:
$$\hat{x} = ct(y) + b$$
which must also be the ML estimator (as shown previously)
||

||theorem Corollary
If the model is from a canonical exponential family, then an efficient estimator exists iff the Fisher information $J_y(x)$ is constant and does not depend on the parameter $x$
||

### Multi-Parameter Exponential Families

The above single-parameter families generalize naturally to distributions with multiple parameters

||definition Multi-Parameter Exponential Families
For some $\mc{X} \in \reals^L$ containing an open, nonempty set, a parameterized family of distributions $p(\cdot; \vec{x})$ is a $K$-parameter exponential family with:

- Natural parameter $\lambda(\cdot) = \bracket{\lambda_1(\cdot), \dots, \lambda_K(\cdot)}^T: \mc{X} \rightarrow \reals^K$
- Natural statistic $t(\cdot) = \bracket{t_1(\cdot), \dots, t_K(\cdot)}^T: \mc{Y} \rightarrow \reals^K$
- Log base function $\beta(\cdot): \mc{Y} \rightarrow \reals$
  with the form:
  $$p_y(y; x) = \t{exp}\paren{\lambda(x)^T t(y) - \alpha(x) + \beta(y)}$$
  ||

The corresponding partition function is:
$$Z(x) = e^\alpha(x) = \sum_y \t{exp}\paren{\lambda(x)^T t(y) + \beta(y)}$$

- This is replaced with an integral when $y$ is continuous-valued

A **canonical multi-parameter exponential family** is one with $\lambda(x) = x$

The previous properties shown for exponential families readily extend to those for multi-parameter, and we omit the details

- Generally, we replace derivative with gradient and second derivative with Hessian
- We replace variance with the covariance matrix

### Categorizing and Reducing Exponential Families

For a family of distributions, in order for $y$ to be useful in estimating $x$, the distribution $p_y(\cdot, x)$ must be associated with a unique value of $x$

- In this case, we say the parameter is **identifiable** from $y$ in family
- These are the only families that are of interest
- Formally, this means that there does not exist a $x_1$ and $x_2$ s.t. $x_1 \neq x_2$ and $p_y(\cdot; x_1) = p_y(\cdot; x_2)$

||theorem Identifiability of Natural Parameters in Exponential Families
The parameter of a canonical exponential family is identifiable iff the natural statistics satisfy no affine constraint:

That is:
$$\sum_{k=1}^K b_k t_k(\cdot) = c$$
holds only if $b_1 = \cdots = b_K = c = 0$
||

For general exponential families, there are additional requirements for identifiability

#### Minimal Families

Identifiable exponential families may be reducible:

- Consider $\lambda(x) = \bracket{x, 2x-1}$
- We have $\ln p_y(y; x) = x t_1(y) + (2x-1)t_2(y) - \alpha(x) + \beta(y)$
  - This can be equivalently exxpressed as $x(t_1(y) - 2t_2(y)) - \alpha(x) + (\beta(y) - t_2(y))$ which is an exponential family of smaller dimension
- This is known as reducing the exponential family

||theorem Reducibility of Exponential Families
Any exponential family of dimension $K \geq 2$ that has the natural parameters not satisfying any affine constraint cannot be reduced. In fact, any exponential family whose natural parameters satisfy an affine constraint can be expressed as one of dimension $K - 1$
||

Some minimal families may satisfy non-linear constraints, which results in the natural parameter space not being an open subset of $\reals^K$

- A **full rank** exponential family is a minimal exponential family whose parameter space for $\lambda$ includes an open, nonempty set in $\reals^K$
- When a minimal exponential family is not full-rank, it is **curved**

### Exponential Families over Finite Alphabets

We consider for a collection of possible probability distributions, to what degree can an exponential family "cover" this set?

- For distributions over a finite alphabet $\mc{Y}$, this is straightforward: we can construct a canonical exponential family over all positive distributions

Let $\mc{Y} = \{1, \dots, M\}$ and then the $M$-dimensional canonical exponential family is:
$$p_y(y; x) = \t{exp}\p{\sum_{i=1}^M x_i t_i(y) - \alpha(x)}$$
with:
$$t_i(y) = 1_{y=i}$$

We then have that $p_y(j; x) \propto e^{x_j}$ for all $j$

- Therefore, for any arbitrary distribution over $\mc{Y}$ $q(\cdot)$, we just take:
  $$x_i = \ln q(i)$$
  and we get the correct probabilities for each class

### Inference

One thing to note is that when computing the probability distribution $p_y(y; x)$, the data $y$ participates only through the natural statistics $t(y)$ and $\beta(y)$

- Once we compute these $K + 1$ numbers, we can throw away the data and just use these statistics to perform inference on $x$
- In fact, in exponential families, we don't even need $\beta(y)$
- To take the MLE estimator, we just need to maximize $\ln p_y(y; x)$ across $x$, and since $\beta(y)$ is just an additive term, we can get away with not even computing it

This is an example of sufficient statistics, which are functions of the data that are "loss-free" representations for the purpose of inference
