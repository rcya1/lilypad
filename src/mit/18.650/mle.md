---
title: MLE
date: 2024-10-01
order: 5
---

## MLE

The MLE has three key properties:

- Consistency ( $\hat{\theta}^{MLE} \xrightarrow{\mathbb{P}} \theta^*$ )
- Asymptotically normal ( $\sqrt{n}(\hat{\theta}^{MLE} - \theta^*) \rightsquigarrow \mathcal{N}(0, \sigma^2_{MLE})$ )
- Asymptotic efficiency (for any other estimator that is asymptotically normal, its asymptotic variance is at least that of the MLE estimator)

**Note**:

- The MLE is not always asymptotically normal!
  - If the log likelihood is differentiable, then it is asymptotically normal
  - Otherwise, it is not guaranteed
- As an example, the log likelihood for a uniform distribution between $[0, \theta]$ is not differentiable, but the MLE is just the max of the datapoints
  - Then, $\sqrt{n}(\hat{\theta}^{MLE} - \theta^*) \rightsquigarrow 0$, and does not become normal
  - Can see this because the term in parentheses will always be negative, and normal variables are both positive and negative

## MLE Alternative Origin

- For each $\theta$, we want to compute the "distance" between the distribution $P_\theta$ and $P_{\theta^*}$
- We can't compute this exactly since we only have samples, so we will approximate the distance, which we will denote as $\widehat{\text{dist}}(P_\theta, P_{\theta^*})$
- We need this distance metric to satisfy:
  - Approximately computable from samples
  - Minimized only at $\theta^*$
    - Should be $0$ at $\theta^*$ and $>0$ everywhere else

||definition KL Divergence
Let $f_{\theta^*}$ and $f_\theta$ be the pdfs associated with $P_{\theta^*}$ and $P_\theta$ respectively. Then, the KL divergence is defined as:
$$D_{KL}(P_{\theta^*} \| P_\theta) = \int f_{\theta^*} \log \paren{\frac{f_{\theta^*}(x)}{f_\theta(x)}} dx $$
||

**Notes**:

- Isn't symmetric and doesn't satisfy triangle inequality, so not really a "distance"
- This function is always non-negative and is 0 only when $P_\theta = P_{\theta^*}$
  - If the parameter is identifiable, then this means $\theta = \theta^*$ is the unique minimizer of the KL divergence

We can rewrite the KL divergence as:
$$D_{KL}(P_{\theta^*} \| P_\theta) = \int f_{\theta^*}(x) \log f_{\theta^*}(x) dx - \int f_{\theta}(x) \log f_{\theta}(x) dx$$

The first term is actually fixed, so minimizing this is equivalent to just maximizing:
$$\int f_{\theta^*}(x) \log f_{\theta}(x) dx = \mathbb{E}_{\theta^*}\bracket{\log f_\theta(X)}$$

An expectation can be approximated with a sample average, so this just becomes maximizing:

$$\frac{1}{n} \sum_{i=1}^n \log f_\theta(X_i)$$

This is just our original MLE definition but with an extra $1/n$ (which can be safely discarded)!

||definition Population Log-Likelihood
$$\ell(\theta) = \mathbb{E}_{\theta^*} \bracket{\log f_\theta(X)}$$
This is known as the **population log-likehood** and it is maxmized at $\theta^*$
||

Note that the sample log likelihood we defined earlier was $\ell_n(\theta)$, which is taken over $n$ samples

### MLE Consistency

**Proof**:

- We have $\frac{1}{n} \ell_n(\theta) = \frac{1}{n} \log f_\theta(X_i)$
- As $n \rightarrow \infty$, we have that this equals $\ell(\theta)$ via the LLN
- Therefore, the maximizer of $\frac{1}{n} \ell(n)$ converges to the maximizer of $\ell$, which is $\theta^*$

### MLE Asymptotic Normality

||definition Fisher Information
Consider a statistical model with pdf $f_\theta$. If $\theta$ is one-dimensional, then the **Fisher information** is defined as:
$$I(\theta) = \mathbb{E}_\theta\bracket{-\frac{d^2}{d\theta^2} \log f_\theta(X)} = \mathbb{V}_\theta \bracket{\frac{d}{d\theta} \log f_\theta(X)}$$

If $\theta$ is a multi-dimensional parameter, then the **Fisher information matrix** is defined as:
$$I(\theta) = \mathbb{E}_\theta\bracket{-\nabla_\theta^2 \log f_\theta(X)} = \mathbb{V}_\theta \bracket{\nabla \log f_\theta(X)}$$
||

- Reminder: here, $\nabla^2$ refers to the Hessian, which is the matrix such that:
  - $\paren{\nabla^2 f}_{ij} = \frac{\partial^2 f}{\partial x_i \partial x_j} = \pfrac{}{x_i} \pfrac{}{x_j}$
- The other one is the Laplacian, which can also be written as $\Delta$:
  - $\Delta f = \nabla^2 f = \nabla \cdot (\nabla f)$, or the divergence of the gradient
  - $\nabla^2 f = f_{xx} + f_{yy} + f_{zz} + \dots$
  - This is also just the trace of the Hessian
- The fact that the expectation of the second derivative is equal to the variance of the first derivative is a property that requires proof
  - It is not immediately obvious

||theorem Asymptotic Variance of MLE
Suppose the ground truth parameter is $\theta^*$. For a sufficiently regular model (i.e a well-behaved density $f_\theta$ ), the MLE has the following limit:
$$\sqrt{n}\paren{\hat{\theta}^{\text{MLE}} - \theta^*} \rightsquigarrow \mathcal{N}\paren{0, I(\theta^*)^{-1}}$$
||

**Proof for 1D**:
For brevity, we use $\hat{\theta}$ to denote the MLE estimate

We know that $\hat{\theta}$ minimizes the $\ell_n(\theta)$, so we have $\ell'_n(\hat{\theta}) = 0$

Since $\hat{\theta}$ is close to $\theta^*$ via consistency, we can Taylor expand $\ell_n'(\theta)$ around $\theta^*$ as:

$$0 = \ell'_n(\hat{\theta}) \approx \ell'_n(\theta^*) + \ell_n''(\theta^*)(\hat{\theta} - \theta^*)$$

Rearranging gives us and defining the appropriate $Y_i$ and $W_i$ gives:

$$
\begin{align*}
\sqrt{n}(\hat{\theta} - \theta^*) &\approx \frac{-\sqrt{n} \cdot \ell_n'(\theta^*)}{\ell_n''(\theta^*)} \\
&= -\frac{\sqrt{n} \sum \deriv{}{\theta} \paren{\log f_\theta(X_i)} \mid_{\theta = \theta^*}}{\sum \frac{d^2}{d\theta^2} \paren{\log f_\theta(X_i)} \mid_{\theta = \theta^*}} \\
&= -\frac{\sqrt{n} \sum Y_i}{\sum W_i} \\
&= -\frac{\sqrt{n} \overline{Y_n}}{\overline{W_n}}
\end{align*}
$$

We note that $\exp{Y_i}$ is equal to:

$$\paren{\deriv{}{\theta} \exp{\log f_\theta(X)}} \mid_{\theta = \theta^*} = \ell'(\theta^*) = 0$$

We also have that $\var{Y_i}$ is just exactly the definition of Fisher information $I(\theta)$. Therefore, the CLT tells us that
$$\sqrt{n}\overline{Y_n} \rightsquigarrow \mathcal{N}(0, I(\theta^*))$$

We also have by the LLN that $\overline{W_n}$ converges to $\exp{W_i}$, which is just exactly $-I(\theta^*)$

Applying Slutsky's, we have that:

$$\sqrt{n}(\hat{\theta} - \theta^*) \rightsquigarrow \mathcal{N}(0, I(\theta^*)) / I(\theta^*) = \mathcal{N}(0, I(\theta^*)^{-1})$$
