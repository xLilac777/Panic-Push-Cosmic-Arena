window.PanicUI = {
  colorToCss(value) {
    return `#${Number(value).toString(16).padStart(6, "0")}`;
  }
};
