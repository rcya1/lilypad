---
title: Method Of Moments
date: 2024-10-07
order: 7
---

## Method of Moments

||definition Moment
The $j$ th moment of $X$ is $\alpha_j = \exp{X^j}$
||

With the pdf $f_\theta$, this is function of $\theta$:

$$\alpha_j = \int x^j f_\theta(x)dx$$

With the plug-in method, we can estimate this as:

$$\hat{\alpha_j} = \frac{1}{n} \sum_{i=1}^n X_i^j$$

We can therefore solve for $\theta$ by setting $\hat{alpha_j} = \alpha_j$

- If we have multiple values in $\theta$, we will need as many different moments in our system of equations

For a normal random variable with mean $\mu$ and variance $\sigma^2$, we can compute the moments as:

$$\begin{align*}\alpha_1 &= \mu \\ \alpha_2 &= \mu^2 + \sigma^2\end{align*}$$

We can then solve this to get:

$$
\begin{align*}
\mu &= \alpha_1 \approx \hat{\alpha_1}\\
\sigma^2 &= \alpha_2 - \alpha_1^2 \approx \hat{\alpha_2} - \hat{\alpha_1}^2
\end{align*}
$$

This was solvable in closed form, but generally we might have to do other things to solve this

||theorem Asymptotic Properties of Method of Moments
The method of momenys estimator is consistent and asymptotically normal
||
