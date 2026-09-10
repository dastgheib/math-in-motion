# Math in Motion

A gallery of visual explanations for engineering mathematics.

## Website

The Quarto website is located in [`site/`](site/).

Preview locally:

```bash
cd site
quarto preview
```

Render locally:

```bash
cd site
quarto render
```

## Adding an Animation

Create a directory under:

```text
site/animations/
```

Each animation should include:

```text
index.qmd
thumbnail.webp
animation.mp4
```

The page front matter should include:

```yaml
title: "Animation Title"
description: "Short gallery description."
author:
  - name: "Student Name"
image: "thumbnail.webp"
image-alt: "Accessible description of the thumbnail."
```
