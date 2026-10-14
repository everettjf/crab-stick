/* Original Crab character. SPDX-License-Identifier: MIT */
#include "muse_pixel.h"
#include <math.h>
#include <stdlib.h>
#include <string.h>

static uint16_t frame[64 * 64];
static int size = 128;
static uint16_t rgb(unsigned c) {
  return ((c >> 8) & 0xf800) | ((c >> 5) & 0x07e0) | ((c >> 3) & 31);
}
static void pixel(int x, int y, unsigned c) {
  if (x >= 0 && x < 64 && y >= 0 && y < 64)
    frame[y * 64 + x] = rgb(c);
}
static void box(int x, int y, int w, int h, unsigned c) {
  for (int j = 0; j < h; j++)
    for (int i = 0; i < w; i++)
      pixel(x + i, y + j, c);
}
static void disk(int x, int y, int rx, int ry, unsigned c) {
  for (int j = -ry; j <= ry; j++)
    for (int i = -rx; i <= rx; i++)
      if (i * i * ry * ry + j * j * rx * rx <= rx * rx * ry * ry)
        pixel(x + i, y + j, c);
}
static void line(int x, int y, int xx, int yy, unsigned c) {
  int n = abs(xx - x) > abs(yy - y) ? abs(xx - x) : abs(yy - y);
  if (!n) {
    pixel(x, y, c);
    return;
  }
  for (int i = 0; i <= n; i++)
    box(x + (xx - x) * i / n, y + (yy - y) * i / n, 2, 2, c);
}
uint32_t muse_pixel_accent(muse_mode_t m) {
  static const unsigned colors[] = {0xffcb77, 0xff895e, 0x77dcff, 0xd5a0ff,
                                    0x87efbf, 0xff6787, 0x7186a6};
  return m >= 0 && m < MUSE_MODE_COUNT ? colors[m] : colors[1];
}
void muse_pixel_set_size(int px) { size = px < 1 ? 1 : px > 512 ? 512 : px; }
void muse_pixel_render(const muse_pose_t *p) {
  const unsigned ink = 0x542d3b, shell = 0xf56b48, light = 0xffac6d,
                 shade = 0xc84740, white = 0xfff2ce;
  memset(frame, 0, sizeof(frame));
  float t = p->t;
  int y = 36 + (int)roundf(sinf(t * 2) * 1.0f), dx = 0;
  bool happy = p->happy > 0.05f, off = p->mode == MUSE_MODE_OFF,
       err = p->mode == MUSE_MODE_ERROR;
  if (happy) {
    y -= 3 + (int)(fabsf(sinf(t * 10)) * 4);
    dx = (int)(sinf(t * 8) * 2);
  }
  if (p->mode == MUSE_MODE_BOOT)
    y += (int)(fmaxf(0, 1 - p->mode_t / 1.2f) * 25);
  int x = 32 + dx;
  disk(x, 53, 18, 2, 0x192738);
  /* Three walking legs per side. */
  for (int side = -1; side <= 1; side += 2)
    for (int j = 0; j < 3; j++) {
      int wiggle = off ? 0 : (int)roundf(sinf(t * 3 + j) * 1.5f);
      line(x + side * 13, y + j * 3, x + side * (22 - j),
           y + 3 + j * 4 + wiggle, ink);
      line(x + side * (22 - j), y + 3 + j * 4 + wiggle, x + side * (25 - j),
           y + 6 + j * 4, shade);
    }
  /* Raised pincers, an open V cut out of a chunky claw. */
  for (int side = -1; side <= 1; side += 2) {
    int wave = happy                           ? (int)(sinf(t * 9 + side) * 3)
               : p->mode == MUSE_MODE_SPEAKING ? (int)(p->level * 5)
                                               : 0;
    int cy = off ? y + 4 : err ? y - 2 : y - 13 - wave;
    if (p->mode == MUSE_MODE_LISTENING && side == 1)
      cy -= 5;
    if (p->mode == MUSE_MODE_THINKING)
      cy += (int)(sinf(t * 5 + side) * 2);
    int cx = x + side * (off ? 13 : 22);
    line(x + side * 13, y - 1, cx, cy + 6, ink);
    line(x + side * 13, y - 2, cx, cy + 5, shell);
    disk(cx, cy, 7, 7, ink);
    disk(cx, cy - 1, 6, 6, shell);
    box(cx - 3, cy - 5, 3, 3, light);
    for (int k = 0; k < 6; k++)
      box(cx - k / 2, cy - 7 + k, 1 + k, 1, 0);
  }
  disk(x, y, 17, 12, ink);
  disk(x, y - 1, 16, 11, shade);
  disk(x, y - 3, 15, 9, shell);
  box(x - 9, y - 9, 17, 2, light);
  box(x - 12, y - 6, 3, 3, light);
  for (int side = -1; side <= 1; side += 2) {
    int ex = x + side * 7, ey = y - 17;
    line(ex, y - 9, ex, ey, ink);
    box(ex - 1, ey, 3, 9, shell);
    disk(ex, ey, 4, 5, ink);
    disk(ex, ey - 1, 3, 4, white);
    bool blink = off || (!happy && fmodf(t, 4.5f) > 4.32f);
    if (blink)
      box(ex - 2, ey, 5, 1, ink);
    else if (happy) {
      line(ex - 2, ey, ex, ey - 2, ink);
      line(ex, ey - 2, ex + 2, ey, ink);
    } else {
      int look =
          p->mode == MUSE_MODE_THINKING ? (int)roundf(sinf(t * 3) * 1.5f) : 0;
      box(ex - 1 + look, ey - 1, 2, 3, ink);
      pixel(ex + look, ey - 1, 0xffffff);
      if (err)
        line(ex - 3, ey - 4, ex + 3, ey - 2, ink);
    }
  }
  box(x - 11, y - 2, 4, 2, 0xffb4a0);
  box(x + 8, y - 2, 4, 2, 0xffb4a0);
  if (off)
    box(x - 2, y + 4, 4, 1, ink);
  else if (err) {
    line(x - 3, y + 5, x, y + 3, ink);
    line(x, y + 3, x + 3, y + 5, ink);
  } else if (p->mode == MUSE_MODE_SPEAKING)
    disk(x, y + 3, 3, 1 + (int)(p->level * 3), ink);
  else {
    box(x - 3, y + 2, 1, 2, ink);
    box(x + 3, y + 2, 1, 2, ink);
    box(x - 2, y + 4, 5, 1, ink);
  }
  unsigned accent = muse_pixel_accent(p->mode);
  if (p->mode == MUSE_MODE_THINKING)
    for (int i = 0; i < 3; i++)
      disk(26 + i * 6, 6, 1, 1, ((int)(t * 3) % 3) == i ? accent : 0x293245);
  if (p->mode == MUSE_MODE_LISTENING)
    for (int i = 0; i < 3; i++)
      box(5 + i * 3, 7 + (3 - i), 2, 3 + i * 2, accent);
  if (happy) {
    disk(49, 7, 2, 2, 0xff6b9a);
    disk(53, 7, 2, 2, 0xff6b9a);
    line(47, 8, 51, 13, 0xff6b9a);
    line(55, 8, 51, 13, 0xff6b9a);
  }
  if (off) {
    box(48, 10, 6, 1, accent);
    line(53, 10, 48, 15, accent);
    box(48, 15, 6, 1, accent);
  }
}
void muse_pixel_scale(uint16_t *dst, int stride, int x0, int x1, int y0,
                      int y1) {
  for (int y = y0; y <= y1; y++)
    for (int x = x0; x <= x1; x++) {
      int sx = x * 64 / size, sy = y * 64 / size;
      dst[(y - y0) * stride + x - x0] =
          (sx >= 0 && sx < 64 && sy >= 0 && sy < 64) ? frame[sy * 64 + sx] : 0;
    }
}
