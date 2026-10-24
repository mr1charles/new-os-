#!/usr/bin/env python3
"""Generate helix-watch.kicad_pcb: a placed, net-assigned (but not yet routed) 2-layer smartwatch board.

Everything about the board lives in this file (parts, positions, nets) so the layout can be
reviewed as a diff. Run:  python3 build.py   ->  helix-watch.kicad_pcb
"""
import math
import uuid
from pathlib import Path

from sexpr import Str, dump, find, parse

FP_LIB = Path('/usr/share/kicad/footprints')
CX, CY = 100.0, 100.0        # board centre in KiCad sheet coordinates (mm, y down)
BOARD_DIA = 44.0
OUT = Path(__file__).with_name('helix-watch.kicad_pcb')

# --- ESP32-S3-WROOM-1 pad numbers (datasheet table 3-1) -> net -------------------------------
# GPIO choices avoid: octal-PSRAM pins IO35-37, strapping pins IO0/3/45/46 (except IO0 = BOOT).
ESP32_NETS = {
    '1': 'GND', '40': 'GND', '41': 'GND', '2': '+3V3', '3': 'EN',
    '27': 'BOOT',                                   # IO0
    '39': 'VBAT_SENSE',                             # IO1  (ADC1_CH0)
    '38': 'BTN',                                    # IO2  (RTC GPIO: wakes from deep sleep)
    '4': 'IMU_INT',                                 # IO4  (RTC GPIO)
    '5': 'SDA', '6': 'SCL',                         # IO5 / IO6
    '7': 'MOTOR_DRV',                               # IO7
    '12': 'CHG_STAT',                               # IO8
    '17': 'DISP_CS', '18': 'DISP_CLK',              # IO9 / IO10   (QSPI AMOLED)
    '19': 'DISP_D0', '20': 'DISP_D1',               # IO11 / IO12
    '21': 'DISP_D2', '22': 'DISP_D3',               # IO13 / IO14
    '8': 'DISP_RST',                                # IO15
    '9': 'TOUCH_INT', '10': 'TOUCH_RST',            # IO16 / IO17
    '11': 'DISP_TE',                                # IO18
    '13': 'USB_DN', '14': 'USB_DP',                 # IO19 / IO20 (native USB: flashing + debug)
    '23': 'I2S_BCLK', '24': 'I2S_WS', '25': 'I2S_DOUT',  # IO21 / IO47 / IO48 reserved for audio rev
    '35': 'PPG_INT',                                # IO42
    '36': 'UART_RX', '37': 'UART_TX',               # IO44 / IO43 (boot log)
}

# (ref, value, "Lib:Footprint", x, y, rot, {pad: net})   x,y relative to board centre
# Top side (display side). The module's antenna keepout (dy < -12) stays empty.
PARTS = [
    ('U1', 'ESP32-S3-WROOM-1-N16R8', 'RF_Module:ESP32-S3-WROOM-1', 0, -5.25, 0, ESP32_NETS),
    ('J1', 'Display FPC 24p 0.5mm', 'Connector_FFC-FPC:Hirose_FH12-24S-0.5SH_1x24-1MP_P0.50mm_Horizontal', 0, 12.6, 0, {}),
    ('J2', 'LiPo 400mAh', 'Connector_JST:JST_SH_SM02B-SRSS-TB_1x02-1MP_P1.00mm_Horizontal', 15.5, 0.5, 90,
     {'1': 'VBAT', '2': 'GND'}),
    ('U2', 'BMI270', 'Package_LGA:Bosch_LGA-14_3x2.5mm_P0.5mm', -14.8, -8.5, 0,
     {'1': 'GND', '4': 'IMU_INT', '5': '+3V3', '6': 'GND', '7': 'GND', '8': '+3V3', '12': '+3V3',
      '13': 'SCL', '14': 'SDA'}),
    ('U3', 'MCP73831T-2ACI/OT', 'Package_TO_SOT_SMD:SOT-23-5', -14.8, -2.0, 0,
     {'1': 'CHG_STAT_OD', '2': 'GND', '3': 'VBAT', '4': 'VBUS', '5': 'CHG_PROG'}),
    ('U4', 'AP2112K-3.3', 'Package_TO_SOT_SMD:SOT-23-5', -14.8, 4.0, 0,
     {'1': 'VBAT', '2': 'GND', '3': 'VBAT', '5': '+3V3'}),
    ('U5', 'AP2112K-1.8', 'Package_TO_SOT_SMD:SOT-23-5', -14.8, 10.0, 0,
     {'1': '+3V3', '2': 'GND', '3': '+3V3', '5': '+1V8'}),
    ('Q1', 'SI2302', 'Package_TO_SOT_SMD:SOT-23', 15.5, 7.0, 0,
     {'1': 'MOTOR_DRV', '2': 'GND', '3': 'MOTOR_N'}),
    ('D1', '1N4148W', 'Diode_SMD:D_SOD-123', 14.0, 11.5, 0, {'1': '+3V3', '2': 'MOTOR_N'}),
    ('SW1', 'Side button', 'Button_Switch_SMD:SW_SPST_B3U-1000P', 15.5, -9.0, 0, {'1': 'BTN', '2': 'GND'}),
]

C, R = 'Capacitor_SMD:C_0402_1005Metric', 'Resistor_SMD:R_0402_1005Metric'
PASSIVES = [
    ('C1', '10uF', C, -11.7, -10.3, 90, {'1': '+3V3', '2': 'GND'}),       # module 3V3 bulk
    ('C2', '100nF', C, -11.7, -8.0, 90, {'1': '+3V3', '2': 'GND'}),
    ('C10', '100nF', C, -14.8, -11.1, 0, {'1': '+3V3', '2': 'GND'}),     # IMU
    ('R1', '10k', R, -11.7, -5.7, 90, {'1': 'EN', '2': '+3V3'}),         # EN reset RC
    ('C3', '1uF', C, -11.7, -3.4, 90, {'1': 'EN', '2': 'GND'}),
    ('R3', '10k', R, -14.8, -5.7, 0, {'1': 'CHG_STAT_OD', '2': '+3V3'}),
    ('R2', '5k', R, -14.8, -4.6, 0, {'1': 'CHG_PROG', '2': 'GND'}),
    ('C6', '4.7uF', C, -11.7, -0.6, 90, {'1': 'VBUS', '2': 'GND'}),
    ('C7', '4.7uF', C, -17.9, -2.0, 90, {'1': 'VBAT', '2': 'GND'}),
    ('C4', '1uF', C, -11.7, 4.0, 90, {'1': 'VBAT', '2': 'GND'}),
    ('C5', '1uF', C, -17.9, 4.0, 90, {'1': '+3V3', '2': 'GND'}),
    ('C8', '1uF', C, -11.7, 10.0, 90, {'1': '+3V3', '2': 'GND'}),
    ('C9', '1uF', C, -17.9, 10.0, 90, {'1': '+1V8', '2': 'GND'}),
    ('R4', '4.7k', R, 12.0, -5.0, 90, {'1': 'SDA', '2': '+3V3'}),
    ('R5', '4.7k', R, 13.5, -5.0, 90, {'1': 'SCL', '2': '+3V3'}),
    ('R9', '10k', R, 15.5, -6.5, 0, {'1': 'BTN', '2': '+3V3'}),
    ('R6', '100k', R, 12.0, 5.2, 0, {'1': 'VBAT', '2': 'VBAT_SENSE'}),
    ('R7', '100k', R, 12.0, 6.5, 0, {'1': 'VBAT_SENSE', '2': 'GND'}),
    ('R8', '100k', R, 12.0, 8.2, 0, {'1': 'MOTOR_DRV', '2': 'GND'}),
]

# Back (skin) side. Written directly rather than from the library: plain pads / solder points.
#   (ref, value, x, y, [(pad name, dx, w, h, net)])
BACK_ROWS = [
    ('J3', 'PPG sensor flex (6 pads)', 0, 3.2,
     [('1', -7.5, '+3V3'), ('2', -4.5, '+1V8'), ('3', -1.5, 'SDA'), ('4', 1.5, 'SCL'),
      ('5', 4.5, 'PPG_INT'), ('6', 7.5, 'GND')], (1.8, 2.4)),
    ('J4', 'Programming pads', 0, -8.5,
     [('1', -6.0, 'USB_DP'), ('2', -3.0, 'USB_DN'), ('3', 0.0, 'BOOT'), ('4', 3.0, 'EN'), ('5', 6.0, 'GND')],
     (1.6, 1.6)),
    ('P1', 'Charge contacts', 0, 14.5, [('1', -5.0, 'VBUS'), ('2', 5.0, 'GND')], (3.0, 3.0)),
    ('M1', 'ERM motor', 0, 12.0, [('1', -13.0, '+3V3'), ('2', 13.0, 'MOTOR_N')], (2.5, 1.6)),
]


class Board:
    def __init__(self):
        self.nets = {'': 0}
        self.items = []

    def net(self, name):
        if name not in self.nets:
            self.nets[name] = len(self.nets)
        return name

    def ref(self, name):
        return ['net', self.nets[self.net(name)], Str(name)]


def uid():
    return ['uuid', Str(str(uuid.uuid4()))]


def library_footprint(board, ref, value, fp, x, y, rot, nets):
    lib, name = fp.split(':')
    node = parse((FP_LIB / f'{lib}.pretty' / f'{name}.kicad_mod').read_text())
    out = [node[0], Str(fp)]
    for c in node[2:]:
        if not isinstance(c, list):
            continue
        if c[0] in ('version', 'generator', 'generator_version', 'embedded_fonts'):
            continue
        if c[0] == 'layer':
            out.append(c)
            out.append(uid())
            out.append(['at', f'{CX + x:.4f}', f'{CY + y:.4f}'] + ([str(rot)] if rot else []))
            continue
        if c[0] == 'property' and c[1] == 'Reference':
            c[2] = Str(ref)
        if c[0] == 'property' and c[1] == 'Value':
            c[2] = Str(value)
        if c[0] == 'pad':
            if rot:                                 # board files store pad angles *including* the footprint's
                at = find(c, 'at')[0]
                ang = (float(at[3]) if len(at) > 3 else 0.0) + rot
                at[:] = at[:3] + [f'{ang % 360:g}']
            pad_no = str(c[1])
            if pad_no in nets:
                c.append(board.ref(nets[pad_no]))
            c.append(uid()) if not find(c, 'uuid') else None
        out.append(c)
    # (path ...) / sheet info lets KiCad treat this as an unannotated-schematic footprint.
    return out


def own_footprint(board, ref, value, x, y, layer, pads, outline=None):
    """Hand-built footprint on one copper layer. pads: [(num, dx, dy, w, h, net)]"""
    cu = layer
    mask = cu.replace('.Cu', '.Mask')
    silk = cu.replace('.Cu', '.SilkS')
    fab = cu.replace('.Cu', '.Fab')
    out = ['footprint', Str(f'helix:{value}'), ['layer', Str(cu)], uid(),
           ['at', f'{CX + x:.4f}', f'{CY + y:.4f}'],
           ['property', Str('Reference'), Str(ref), ['at', '0', '-3', '0'], ['layer', Str(silk)], uid(),
            ['effects', ['font', ['size', '1', '1'], ['thickness', '0.15']]]],
           ['property', Str('Value'), Str(value), ['at', '0', '3', '0'], ['layer', Str(fab)], uid(),
            ['effects', ['font', ['size', '1', '1'], ['thickness', '0.15']]]],
           ['attr', 'smd']]
    for num, dx, dy, w, h, net in pads:
        pad = ['pad', Str(num), 'smd', 'roundrect', ['at', str(dx), str(dy)], ['size', str(w), str(h)],
               ['layers', Str(cu), Str(mask)], ['roundrect_rratio', '0.25']]
        if net:
            pad.append(board.ref(net))
        pad.append(uid())
        out.append(pad)
    if outline:
        w, h = outline
        out.append(['fp_rect', ['start', str(-w / 2), str(-h / 2)], ['end', str(w / 2), str(h / 2)],
                    ['stroke', ['width', '0.12'], ['type', 'solid']], ['fill', 'none'], ['layer', Str(silk)], uid()])
    return out


def main():
    b = Board()
    for name in ['GND', '+3V3', '+1V8', 'VBAT', 'VBUS', 'SDA', 'SCL']:
        b.net(name)

    fps = []
    for ref, value, fp, x, y, rot, nets in PARTS + PASSIVES:
        fps.append(library_footprint(b, ref, value, fp, x, y, rot, nets))

    for ref, value, x, y, pads, (w, h) in BACK_ROWS:
        fps.append(own_footprint(b, ref, value, x, y, 'B.Cu', [(n, dx, 0, w, h, net) for n, dx, net in pads]))

    header = [
        ['version', '20241229'], ['generator', Str('helix-watch-build')], ['generator_version', Str('1')],
        ['general', ['thickness', '0.8'], ['legacy_teardrops', 'no']],
        ['paper', Str('A4')],
        ['layers',
         [0, Str('F.Cu'), 'signal'], [4, Str('In1.Cu'), 'signal'], [6, Str('In2.Cu'), 'signal'], [2, Str('B.Cu'), 'signal'],
         [9, Str('F.Adhes'), 'user', Str('F.Adhesive')], [11, Str('B.Adhes'), 'user', Str('B.Adhesive')],
         [13, Str('F.Paste'), 'user'], [15, Str('B.Paste'), 'user'],
         [5, Str('F.SilkS'), 'user', Str('F.Silkscreen')], [7, Str('B.SilkS'), 'user', Str('B.Silkscreen')],
         [1, Str('F.Mask'), 'user'], [3, Str('B.Mask'), 'user'],
         [17, Str('Dwgs.User'), 'user', Str('User.Drawings')], [19, Str('Cmts.User'), 'user', Str('User.Comments')],
         [21, Str('Eco1.User'), 'user', Str('User.Eco1')], [23, Str('Eco2.User'), 'user', Str('User.Eco2')],
         [25, Str('Edge.Cuts'), 'user'], [27, Str('Margin'), 'user'],
         [31, Str('F.CrtYd'), 'user', Str('F.Courtyard')], [29, Str('B.CrtYd'), 'user', Str('B.Courtyard')],
         [35, Str('F.Fab'), 'user', Str('F.Fabrication')], [33, Str('B.Fab'), 'user', Str('B.Fabrication')]],
        ['setup',
         ['pad_to_mask_clearance', '0.05'],
         ['pcbplotparams', ['layerselection', '0x00010fc_ffffffff'], ['outputdirectory', Str('')]]],
    ]

    body = []
    for name, idx in sorted(b.nets.items(), key=lambda kv: kv[1]):
        body.append(['net', idx, Str(name)])
    body += fps
    body.append(['gr_circle', ['center', f'{CX}', f'{CY}'], ['end', f'{CX + BOARD_DIA / 2}', f'{CY}'],
                 ['stroke', ['width', '0.1'], ['type', 'solid']], ['fill', 'none'], ['layer', Str('Edge.Cuts')], uid()])

    # Antenna keepout: no copper on either layer above the module's PCB antenna.
    y_top, y_bot = CY - 23.0, CY - 5.25 - 6.75
    pts = [(CX - 24, y_top), (CX + 24, y_top), (CX + 24, y_bot), (CX - 24, y_bot)]
    body.append(['zone', ['net', '0'], ['net_name', Str('')], ['layers', Str('F.Cu'), Str('B.Cu')], uid(),
                 ['name', Str('ANT_KEEPOUT')], ['hatch', 'edge', '0.5'],
                 ['connect_pads', ['clearance', '0']], ['min_thickness', '0.25'],
                 ['keepout', ['tracks', 'not_allowed'], ['vias', 'not_allowed'], ['pads', 'not_allowed'],
                  ['copperpour', 'not_allowed'], ['footprints', 'allowed']],
                 ['fill', ['thermal_gap', '0.5'], ['thermal_bridge_width', '0.5']],
                 ['polygon', ['pts'] + [['xy', f'{x:.3f}', f'{y:.3f}'] for x, y in pts]]])

    pcb = ['kicad_pcb'] + header + body
    OUT.write_text(dump(pcb) + '\n')
    print(f'wrote {OUT.name}: {len(fps)} footprints, {len(b.nets) - 1} nets')


if __name__ == '__main__':
    main()
