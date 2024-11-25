---
title: Bayesian Inference
date: 2024-11-21
order: 14
---

## Bayesian Inference

- So far we have been working with frequentist inference
  - The interpretation of an event with probability 0.9 is that if we repeat it many times, then the event will occur 90% of the tiem
- Bayesian approach is alternative method to produce estimators / confidence intervals / tests

### Bayesian Method

- In the Bayesian world, we first have aprior pdf $f(\theta)$ which indicates our prior belief about $\theta$ before seeing the data
- After seeing the data, we update it into a posterior belief
  $$P(\theta | \text{data}) = \frac{P(\text{data} | \theta)P(\theta)}{P(\text{data})}$$
- The numerator is just $L_n(\theta) * f(\theta)$ and the bottom is a normalization constant that does not depend on $\theta$
- Therefore, we write our posterior distribution as:
  $$f(\theta | \text{data}) \propto L_n(\theta) f(\theta)$$
- If the prior and posterior turn out to be in the same family of distributions, we call the prior a **conjugate prior**

### Bayes Estimator (mean)

||definition Bayes Estimator
The Bayes estimator is the mean of the posterior, or mean a posteriori
$$\hat{\theta}^\text{Bayes} = \int \theta \cdot f(\theta | \text{data}) d\theta$$
||

This can be hard to compute explicitly because it requires knowing the normalizing constant

- Can approximately compute it using Markov Chain Monte Carlo
  - Markov Chain: draw $\theta_1, \dots, \theta_T$ approximately iid from $f(\theta | X_1, \dots, X_n)$ by simulating a Markov chain
    - This can be done through something like Metropolis Hastings, which requires only the ratio between states, not the actual probability value of the state
  - Monte Carlo: compute the mean of the $\theta_i$ drawn

### MAP (mode)

||definition MAP
The maximum a posteriori, or MAP, is the mode of the posterior:
$$\hat{\theta}^\text{MAP} = \argmax_\theta f(\theta | \text{data})$$
||

The mode and mean do not necessarily have to be close (i.e. think about a bimodal posterior)

To compute the MAP, we can maximize the log posterior, which turns out to maximize:

- $\ell_n (\theta) + \log f(\theta) - \log c_n$
- Recall that $\ell_n$ is the log likelihood and $c_n$ is a constant
- This can also be maximized via gradient ascent

### Posterior interval

This is the analogue of the confidence interval from frequentist inference

||definition Posterior interval
A $(1-\alpha)$ posterior interval is an interval $[a, b]$ such that the probability under the posterior curve between $a$ and $b$ is $1 - \alpha$

$$\int_a^b f(\theta | \text{data}) d\theta = 1-\alpha$$
||

## Choosing a Prior

There are several ways we can use to choose a prior:

1. If we have true prior knowledge we should use that
2. If we choose a conjugate prior, then we can ensure the posterior lies in the same family

- This can be useful if there are known formulas for the mean and mode of probability distributions in this family, so we don't have to use gradient ascent / MCMC to solve
- Examples: Beta prior -> Beta posterior and Gaussian prior -> Gaussian posterior

3. If we have no knowledge, we can choose a uniform prior

- If we need this to span the whole number line, then there's no way to get a valid uniform distribution
- Instead, we can take an improper prior with $f(\theta) = 1$ and this will still lead to a valid posterior distribution
- When we choose $f(\theta) = 1$, this means that we are not weighting $L_n(\theta)$ at all
  - Therefore, the MAP is equal to the MLE

### Gaussian Prior

- If we have a Gaussian prior with mean $0$ and variance $\sigma^2$, we get the posterior is:
  $$\mathcal{N}\paren{\frac{\sigma_i X_i}{n + 1/\sigma^2}, \paren{n + \frac{1}{\sigma^2}}^{-1}}$$
- The mean and mode of a normal distribution are equal, so we have the Bayes estimator and MAP are:
  $$\frac{\overline{X}_n}{1 + 1/n\sigma^2}$$
  - This tells us that as $\sigma \rightarrow \infty$, the Bayes / MAP estimator getes closer to the MLE
  - This is expected, since the less confident we arae about the prior, the more it approaches the unweighted likelihood
