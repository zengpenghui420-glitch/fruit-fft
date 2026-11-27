# 验证码说明（水果塑形测试）

- 格式：`FF` + 4 位字符，字符表 `ABCDEFGHJKMNPQRSTUVWXYZ23456789`（无 I / L / O / 0 / 1）
- 正则：`/^FF[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}$/i`
- 示例形态：`FF****`（此处不公布可售卖码）
- Vault quiz key：`fruit`（发码池 `pools/fruit.txt`，由 vault 维护，不在本仓库）
- 每码最多使用 **3** 次（跨设备共享计数，由 vault `POST /redeem` 扣次）
- 请求：`POST https://snappy-tundra-7uesdvk.tmp.now/redeem`，JSON `{ "quiz": "fruit", "code": "<CODE>" }`
- **重新测试**：清除会话解锁（`fruit_unlocked` / `fruit_code`）后需再次输入码并 redeem，会再扣 1 次
- **查看上次结果**：只读本机 `localStorage` 键 `fruit_last_result`，不扣次
- 解锁态键名：`fruit_unlocked`、`fruit_code`（`sessionStorage`）
- 本仓库**不**存放可卖验证码明文，也**不**接入 Mantle
- 订单号不是验证码，不走上面的 `POST /redeem`。只接受 `P` + 18 位；重复块、逐位 ±1、以及不是 18 位的号提示「订单号格式不对」，不会开始。格式通过后直接开始，不请求 `*.vercel.app`，也不读写 Mantle `orders/`。第一次开始提示「验证成功，还可以测 2 次」；重新测试再记一次（「还可以测 1 次」，然后「这是最后一次」）。刷新、继续这一次、结果恢复、查看上次结果不改变这次显示。显示满 3 次之后仍可进入，提示「验证成功」。显示次数按订单号记在 `fruit_order_uses`

造码（本机 companion，勿把码写进 git）：

```bash
/workspace/quiz-code-api/scripts/mint.sh fruit <CODE> 3
```

或见 `tools/mint.sh`。该脚本只打印用法，不会生成或写入真码。
