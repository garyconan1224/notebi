import axios from 'axios'

const BASE = import.meta.env.VITE_BACKEND_BASE_URL ?? 'http://127.0.0.1:8000'

export const http = axios.create({ baseURL: BASE, timeout: 15000 })

// 响应拦截：BiliNote 风格 {code,msg,data} 或其他格式
http.interceptors.response.use(
  res => {
    const d = res.data
    // 仅当响应包含 code 字段且 code !== 0 时才 reject
    // 对于没有 code 字段的响应（如 /health），直接视为成功
    if (typeof d === 'object' && d !== null && 'code' in d && d.code !== 0) {
      return Promise.reject(new Error(d.msg ?? '请求失败'))
    }
    return res
  },
  err => Promise.reject(err)
)

export default http

