---
title: Minimax Hypothesis Testing
date: 2025-02-19
order: 4
---

## Minimax Hypothesis Testing

So far, we have two approaches to hypothesis testing:

- Bayes testing where we minimize the Bayes risk $\exp{C(H, f(y))}$
- Neyman Pearson testing avoids assigning priors and costs, and tries to maximize the detection probability while keeping the false-alarm probability below a threshold

A third option we will explore here is when we can assign costs, but not come up with priors

- We adopt an adversarial model, where we assume nature will pick the most detrimental prior for whatever decision rule we choose
- We then pick the best possible model, assuming nature will do this

Nature and us are both allowed to use randomized models

- $\varphi(p, r)$ denotes the Bayes risk of our model $r$ assuming the prior probability of being $H_1$ is $p$
  - We also define $\varphi_0(r)$ and $\varphi_1(r)$ as the conditional Bayes risk
- $\varphi_M(r)$ is the max value $\varphi$ can take overall values $p$ for a given $r$
- $r_M$ is then the argmin of $\varphi_M(r)$

An **equalizer rule** is a rule $r$ where $\varphi_0(r) = \varphi_1(r)$

- The Bayes risk does not depend on the $p$
- These will play a special role in the coming analysis

### Example

Consider a threshold of $\eta = (1 - p) / p$

- Corresponds to Bayesian likelihood test with unit costs and a prior $p$

The probability of error is then:
$$P_e = (1-p)P_F\cdot \frac{1-p}{p} + p\p{1-P_D \cdot \frac{1-p}{p}}$$

Suppose the prior is still $p$ but we use a Bayesian likelihood test designed for a prior $q$ that uses a threshold $(1 - q) / q$

-
