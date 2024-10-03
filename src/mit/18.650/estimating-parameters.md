---
title: Estimating Parameters
date: 2024-10-01
order: 4
---

## Estimating Parameters

### Definitions

||definition Parameters of Interest and Nuisance Parameters
Given a statistical model with multiple parameters, there may be some parameters / function of parameters we are interested in estimating. Parameters we care about are **parameters of interest** while those we don't care about are **nuisance parameters**.
||

||definition Identifiable
A parameter $\theta$ is identifiable from the statistical model $P_\theta$ if:
$$P_\theta = P_{\theta'} \Rightarrow \theta = \theta'$$
||

- For a normal distribution, $\sigma^2$ is identifiable, but $\sigma$ is not because it could be positive or negative

### Methods to Estimate Parameters

### Plug-In Method

If a parameter can be represented as an expectation or sum of expectations, then just replace the expectation with the sample average:

For normally distributed $X_i$:

- $\mu = \exp{X_1} \rightsquigarrow \frac{1}{n}\sum_{i=1}^n X_i$
- $\sigma^2 = \exp{X_1^2} - \exp{X_1}^2 \rightsquigarrow \frac{1}{n}\sum_{i=1}^n X_i^2 - \paren{\frac{1}{n}\sum_{i=1}^n X_i}^2$

### Maximum Likelihood

||definition Likelihood
Let $f_\theta(x)$ be the PDF corresponding to $P_\theta$. That is, it is the likelihood of observing a single sample $x$ given that the parameters are $x$.

Then, the **likelihood** function is:
$$L_n(\theta) = \prod_{i=1}^n f_\theta(X_i)$$

This is the probability of observing these $n$ samples given that we have a specific $\theta$.

The **log-likelihood** function is:
$$\ell_n(\theta) = \log L_n(\theta) = \sum_{i=1}^n \log f_\theta(X_i)$$
||

||definition Maximum Likelihood Estimator
The **maximum likelihood estimator** is the point which maximizes the function $\ell_n(\theta)$, i.e.:
$$\hat{\theta} = \argmax \ell_n(\theta)$$
||
