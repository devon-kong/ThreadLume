export async function send(action,data={}){
 if(!globalThis.chrome?.runtime?.id)throw Error('EXTENSION_UNAVAILABLE');
 let response;try{response=await chrome.runtime.sendMessage({ns:'peek-ai-v7',action,...data});}catch{throw Error('EXTENSION_UNAVAILABLE');}
 if(!response?.ok)throw Error(response?.error||'NO_RESPONSE');return response.value;
}
export const ERROR_TEXT={
 CONNECTION_CHANGED:'连接已变化，旧任务已停止。请刷新阅读器后重试。',CONTEXT_CHANGED:'检测到豆包网页上下文可能变化，已停止复用旧连接。请在设置中重新连接。',DISCONNECTED:'尚未连接豆包。前往设置连接后自动生成。',NEEDS_INITIALIZATION:'浏览器重启后需要重新初始化豆包连接。',PERMISSION_REQUIRED:'需要允许 Peek 访问豆包；请在设置中授权。',LOGIN_REQUIRED:'豆包登录已失效，请在可见豆包网页登录。',VERIFICATION_REQUIRED:'豆包拒绝了后台请求。请打开豆包查看提示后重新检测；若无验证提示，无需反复登录。',NETWORK_ERROR:'暂时无法连接豆包，请检查网络后重试。',RATE_LIMITED:'豆包请求频率受限，请稍后重试。',TIMEOUT:'豆包响应超时，请稍后重试。',CANCELLED:'已取消。',ACCESS_REJECTED:'豆包拒绝访问，请打开网页检查访问状态。',NORMAL_CLIENT_REQUEST_NOT_OBSERVED:'尚未观察到豆包正常初始化请求。请等待网页加载完成后返回重试。',APPLICATION_CHANGED:'豆包网页应用已变化，连接已停止。',PROBE_OUTPUT_UNEXPECTED:'检测未返回预期 OK，请重试或检查豆包网页。',SETUP_PAGE_CHANGED:'连接页已关闭或离开豆包，请重新打开。',EXTENSION_UNAVAILABLE:'扩展已更新或不可用，请刷新当前页面。',NO_FIN:'生成未确认完成，请重试此视图。',INVALID_MINDMAP:'脑图格式不完整，请重试脑图。',INVALID_TIMELINE:'时间轴超出视频范围，请重试摘要。',SERVICE_REJECTED:'豆包未接受本次请求，请稍后重试。',SERVER_ERROR:'豆包服务暂时不可用，请稍后重试。',INTERNAL_ERROR:'操作未完成，请重试。',SAVE_FAILED:'设置保存失败，已恢复原值。请重试。'
};
export const errorText=code=>ERROR_TEXT[code]||'本次操作未完成，请重试；原帖和评论不受影响。';
