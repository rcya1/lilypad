---
title: Bootstrap
date: 2024-10-09
order: 8
---

## Bootstrap

So far, our confidence intervals have relied on asymptotic normality

- We rely on being able to calculate asymptotic variance based on:
  - CLT if $\hat{\theta} = \overline{X_n}$
  - Delta method if $\hat{\theta} = g(\overline{X_n})$
  - Fisher information if $\hat{\theta} = \hat{\theta}^\text{MLE}$
- However, what if it is not in one of these three forms?
- What if we tried to get an estimator for the mean of a Poisson variable?
  - We could estimate $\lambda$ with $\overline{X_n}$
  - $\theta$ is the integer such that:
    - $\sum_{k=0}^{\theta-1} p(k) < 0.5$
    - $\sum_{k=0}^\theta p(k) \geq 0.5$
  - Therefore we can write our estimate of median as $\hat{\theta} = g(\overline{X_n})$
  - But this $g$ is not differentiable!
- The key idea is that to estimate the variance of our estimator $\hat{\theta}$, we need multiple estimates

  - But we used up all $n$ of our samples computing a single estimator
  - Imagine we had $B \cdot n$ samples: then we could compute $B$ estimators and then take their variance

||definition Bootstrap Sample
Given $n$ samples $X_i$, a **bootstrap sample** is a collection of $m$ samples $X_i^*$ such that:
$$X_i^* \sim \hat{\mathbb{P}}_n = \text{Unif}(X_1, \dots, X_n)$$
||

This distribution is known as the **empirical distribution** of the data

- The corresponding CDF is:
  $$\hat{F}_n(x) = \frac{1}{n} \sum 1(X_i \leq x)$$
- With the LLN, one can show this CDF converges in probability to $F(x)$ as $n$ goes to $\infty$

Then, we can compute $B$ bootstrap samples each of size $n$ and can then use the sample variance $v_\text{boot}$

- Note there are two approximations:
  $$v_\text{boot} \approx \mathbb{V}_{\hat{\mathbb{P}}_n}[\hat{\theta}] \approx \mathbb{V}_{\mathbb{P}}[\hat{\theta}]$$
- The first one can be made accurate by just increasing $B$
- The second one relies on the number of samples $n$ which we can't change

## Properties of Bootstrap Sample

- $X_i^* \sim \text{Unif}(X_1, \dots, X_n)$ conditional on $X_1, \dots, X_n$
  - $P(X_i^* = X_j | X_1, \dots, X_n) = 1/n$ for all $j = 1, \dots, n$
- The conditional expectation of $X_i^*$ is the sample mean
- The unconditional expectation of $X_i^*$ is the true mean $\mu$
- The conditional variance of $X_i^*$ is the sample variance
- The unconditional variance is the true variance $\sigma^2$

## Confidence Intervals

- If $\hat{\theta}$ is approximately normal, then we can construct CIs using $\sqrt{v_\text{boot}}$ as our estimate of the standard error
  - But what if we don't know that $\hat{\theta}$ is Gaussian?

### Pivotal Interval

- We want to construct a $1 - \alpha$ confidence interval of the form $(\hat{\theta} - r_1, \hat{\theta} + r_2)$
  $$\begin{align*} 1 - \alpha &= P(\hat{\theta} - r_1 \leq \theta \leq \hat{\theta} + r_2) \\ &= P(\theta - r_2 \leq \hat{\theta} \leq \theta + r_1) \end{align*}$$
- Therefore want in the PDF of $\hat{\theta}$ for $\alpha/2$ to be before and after $\theta - r_2$ and $\theta + r_1$ respectively
  - Equivalent to if $q_i$ represents the $i$ th quantile, we have:
  - $q_{1 - \alpha/2} = \theta - r_2$
  - $q_{\alpha/2} = \theta + r_1$
- However, we don't know $\theta$ nor the quantiles of $\hat{\theta}$!
  - But we can estimate them with our bootstrap samples and our sample

||definition Pivotal Confidence Interval
Given a sample $\hat{\theta}_0$ and $B$ bootstrap samples $\hat{\theta_1}^*, \dots$, the $1 - \alpha$ pivotal CI is:
$$\theta \in \paren{2\hat{\theta_0} - q_{\alpha / 2}^*, 2\hat{\theta_0} - q_{1 - \alpha/2}^*}$$

where we have:

$$
\begin{align*}
\frac{1}{B} \sum_{b=1}^B 1(\theta_b^* > q_{1-\alpha/2}^*) &= 1 - \alpha / 2 \\
\frac{1}{B} \sum_{b=1}^B 1(\theta_b^* > q_{\alpha/2}^*) &= \alpha / 2 \\
\end{align*}
$$

||

### Percentile Interval

- We could also just directly use:
  $$(q_{1 - \alpha / 2}^*, q_{\alpha / 2}^*)$$
- However this is only valid in certain special cases:
  - See 8.5.2 in AoS
