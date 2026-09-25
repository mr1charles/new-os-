/// <reference types="@girs/gjs" />
/// <reference types="@girs/gjs/dom" />
/// <reference types="@girs/glib-2.0" />
/// <reference types="@girs/gobject-2.0" />
/// <reference types="@girs/gio-2.0" />
/// <reference types="@girs/gdk-4.0" />
/// <reference types="@girs/gtk-4.0" />
/// <reference types="@girs/adw-1" />
/// <reference types="@girs/soup-3.0" />
/// <reference types="@girs/pango-1.0" />
/// <reference types="@girs/graphene-1.0" />

/** Directory of the shell sources, injected by `ags run` / `ags bundle`. */
declare const SRC: string

declare module "inline:*" {
  const content: string
  export default content
}

declare module "*.css" {
  const content: string
  export default content
}

declare module "*.scss" {
  const content: string
  export default content
}
