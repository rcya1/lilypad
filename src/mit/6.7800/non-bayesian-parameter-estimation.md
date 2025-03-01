---
title: Non Bayesian Parameter Estimation
date: 2025-02-27
order: 6
---

## Non Bayesian Parameter Estimation

In many problems, it is unnatural to assign a prior distribution to the latent variable of interest

- We instead treat it as deterministic, but unknown
- Instead of having observation models conditioned on some variable $x$, we instead have it be parameterized by $x$
  - This is the notation $p(y | x)$ versus $p(y; x)$

The first thing to note is that if we look at our previous formulation of BLS:
$$\hat{x} = \t{arg min}_f \exp{(x - f(y))^2}$$

- However since $x$ is now fixed, we have this is minimized when we just choose $f(y) = x$
- We can't do this!
- We need to restrict our search to valid estimators that are just statistics of the data

Estimators themselves are functions $\hat{x}(y)$:

- Their bias and variance are functions of $x$ because we take the expectation over all possible $y$

For the beginning, we will focus on just scalar values of $x$ (but $y$ can be vector valued)

### Minimum Variance Unbiased (MVU) Estimators

||definition MVU
A MVU estimator $\hat{x}_*$ is an estimator such that it has 0 bias and of all estimators that have 0 bias, it has the minimum variance $\lambda_{\hat{x}}(x)$ for every possible $x$
||

This could potentially not exist if:

- There are no unbiased estimators
- There are no estimators that uniformly have lower variance for all $x$

In general, there is no systematic procedure to find these or determine if they exist

### Cramer-Rao Bound

||theorem Cramer-Rao Bound (Scalar Version)
Suppose $p_y(y; \cdot)$ for every $y$ is positive and differentiable on $\mc{X} \in \reals$ and satisfies the regularity condition for all $x$:
$$\exp{\pfrac{}{x} \ln p_y(y; x)}$$

Then for any unbiased $\hat{x}(\cdot)$:
$$\lambda_{\hat{x}}(x) \geq \frac{1}{J_y(x)}$$
where $J_y(X)$ is the Fisher information in $y$ about $x$:
$$J_y(x) = \exp{S(y;x)^2}$$
where $S(y;x)$ is the score function for $x$ based on $y$:
$$S(y;x) = \pfrac{}{x} \ln p_y(y;x)$$
||

With an extra regularity condition, we can express the Fisher information as:
||theorem Corollary
If $p_y(y; \cdot)$ also satisfies the regularity condition:
$$\exp{\p{\pfrac{}{x} \ln p_y(y;x)}^2 + \frac{\partial^2}{\partial x^2} \ln p_y(y;x)} = 0$$
then the Fisher information can also be expressed as:
$$J_y(x) = -\exp{\frac{\partial^2}{\partial x^2} \ln p_y(y;x)}$$
||
