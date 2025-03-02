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
$$\exp{\pfrac{}{x} \ln p_y(y; x)} = 0$$

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

- The Fisher information cannot be computed in all problems
  - In these cases, no Cramer-Rao bound exists
- The Fisher information can be interpreted as a measure of curvature
  - I.e. how "peaky" $\ln p_y(y; x)$ is as a function of $xx$
  - The larger $J_y(x)$, the better we expect to be able to resolve the value of $x$ from observations
  - Therefore, the larger the Fisher information, the smaller we expect $\lambda_{\hat{x}}(x)$ to be
- Any estimator that satisfies Cramer-Rao with equality must be a MVU estimator
  - The converse is not true, the Cramer-Rao bound could be not tight
- There are generalizations for biased estimators

#### Regularity Conditions

We interpret the regularity conditions:

- First note
  $$p_y(y; x) \pfrac{}{x} \ln p_y(y; x) = \pfrac{}{x} p_y(y; x)$$
- Then, we have the expectation in the regularity condition is:
  $$\exp{\pfrac{}{x} \ln p_y(y; x)} = \int_{-\infty}^\infty p_y(y; x) \pfrac{}{x} p_y(y; x) dy = \int_{-\infty}^\infty \pfrac{}{x} p_y(y; x) dy = 0$$
- We also have that $\pfrac{}{x} \int_{-\infty}^\infty p_y(y; x) dy = \pfrac{}{x} 1 = 0$
- Therefore we have:

$$\int_{-\infty}^\infty \pfrac{}{x} p_y(y; x) dy = \pfrac{}{x} \int_{-\infty}^\infty p_y(y; x) dy$$

So the regularity condition says taht the orders of integration and differentiation can be interchanged

Similarly, the second regularity condition can be likewise interpreted as stating:
$$\int_{-\infty}^\infty \frac{\partial^2}{\partial x^2}p_y(y; x) dy = \pfrac{}{x} \int_{-\infty}^\infty \pfrac{}{x} p_y(y; x) dy$$

#### Efficiency

||definition Efficient Unbiased Estimator
An unbiased estimator is efficient if it satisfies the Cramer-Rao bound with equality for all $x \in \mc{X}$
||

||theorem Corollary
An estimator $\hat{x}$ is efficient iff it can be expressed in the form:
$$\hat{x}(y) = x + \frac{1}{J_y(x)} S(y; x)$$
where the right hand side must be independent of $x$ for the estimator to be valid
||

- An efficient estimator is guaranteed to be unbiased
- An efficient estimator is unique
- An efficient estimator must be the unique MVU estimator for a problem

### Maximum Likelihood Estimation

||definition MLE
The maximum likelihood estimate $\hat{x}_\text{ML}(y)$ for parameter $x$ is:
$$\hat{x}_\text{ML}(y) = \argmax_{x \in \mc{X}} p_y(y; x)$$
||

It is often convenient to use the likelihood function notation $L_y(x) = p_y(y; x)$

- This emphasizes the perspective in which it is a dependence on $x$ for a fixed $y$ that is of interest

||theorem Corollary
Suppose \mc{X}$ is open, and that an efficient estimator and ML estimator both exist. Then the two are identical.
||

This does not mean that ML estimators are always efficient!

- When an efficient estimator doesn't exist, then the ML estimator might not have special properties
  - I.e. they might not have good variance properties or even be unbiased

One nice property is that the ML estimation commutes with invertible mappings

- If we have $\theta = g(x)$, then $\hat{\theta}_\text{ML}(y) = g(\hat{x}_\text{ML}(y))$
- This is not a property that is shared with other estimators (i.e. Bayesian estimators)
- This doesn't apply when $g$ isn't invertible, but it can be extended

### Gauss-Markov Theorem

We look at a connection between least-squares and MLE estimation when looking at linear models with Gaussian data

||theorem Gauss-Markov Theorem
Suppose data $y$ depends on $x$ through the model:
$$y = Hx + w$$
with $w \sim \mc{N}(0, \Lambda_w)$ where $\Lambda_w$ and $H$ are full rank. Then the MLE estimator $\hat{x}_\t{ML}(y)$:
$$\hat{x}_\t{ML}(y) = \p{H^T\Lambda_w^{-1}H}^{-1} H^T \Lambda_w^{-1}y$$
is the solution to a weighted least-squares problem and is a MVU.
||

The weighted least squares problem is where you find:
$$\argmin_x (y-Hx)^T \Lambda_w^{-1} (y - Hx)$$

||theorem Corollary
When $\Lambda_w \propto I$, the ML estimator is the solution to the ordinary least squares problem
$$\hat{x}_\t{ML}(y) = \argmin_x \norm{y - Hx}_2^2$$
||

**Sketch**:

- Find the MLE by maximizing the likelihood, which turns into minimizing the exponential, which turns out to be exactly the least squares problem
- Can prove that it is of the given form by taking the derivative
- Can show it is a MVU by finding the Fisher information

### Linear Regression

In linear regression, we try to fit a relationship of the form:
$$v = \sum \theta_k u_k = u^T \theta$$

with a suitable weight vector $\theta$

A natural objective fucntion is to minimize according to ordinary least squares:
$$\argmin \norm{v - U\theta}^2_2$$

By applying the previous corollary with $\Lambda_w = I$, we can get that this is exactly equivalent to modeling $v$ as a random vector $v \sim \mc{N}(U^T\theta, I)$ to get:
$$\hat{\theta} = (U^TU)^{-1} U^T v$$

Regularization is often added to the objective fucntion such as ridge regression:
$$\phi_{RR}(\theta) = \norm{v - U\theta}^2_2 - \lambda \norm{\theta}_2^2$$
which results in
$$\hat{\theta}_{RR} = (U^TU + \lambda I)^{-1} U^T v$$

Another method is lasso regression:
$$\hat{\theta}_\t{LASSO} = \argmin_{\curly{\theta : \norm{\theta}_1 \leq \delta}} \phi_\t{OLS}(\theta)$$

### Logistic Regression

Consider a classification setting with variables $y = (u, v)$ where $v \in \{0, 1\}$

A widely used model for their relationship is:
$$p(1 | u; x) = \frac{1}{1 + \t{exp}\p{-x^T t(u)}}$$
$$p(0 | u; x) = \frac{1}{1 + \t{exp}\p{x^T t(u)}}$$
where:
$$t(u) = \bracket{1, t_1(u), \cdots, t_K(u)}^T$$
with $t_k$ being a feature function

When $x$ is known, the minimum probability of error prediction of the label is:
$$\hat{v} = 1(p(1 | u; x) > 1/2) = 1(x^T t(u) \geq 0)$$

The ML parameter estimate is:
$$\hat{x}_\t{ML} = \argmax_x \frac{1}{N} \sum \ln p(v_n | u_n; x)$$
